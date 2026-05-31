package env_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// writeBenchSecrets writes the two secret files (verify token + subscription
// ID) the SecretCache reads from its mount, and returns their paths. Uses
// b.TempDir() so cleanup is automatic.
func writeBenchSecrets(b *testing.B) (tokenPath, subIDPath string) {
	b.Helper()
	dir := b.TempDir()
	tokenPath = filepath.Join(dir, "VERIFY_TOKEN")
	subIDPath = filepath.Join(dir, "SUBSCRIPTION_ID")
	if err := os.WriteFile(tokenPath, []byte("bench-token"), 0o600); err != nil {
		b.Fatalf("write verify token: %v", err)
	}
	if err := os.WriteFile(subIDPath, []byte("12345"), 0o600); err != nil {
		b.Fatalf("write subscription id: %v", err)
	}
	return tokenPath, subIDPath
}

// BenchmarkSecretCache_GetSecrets_CacheHit measures the hot path: secrets
// already loaded and within TTL, so GetSecrets returns from cache under a read
// lock without touching the filesystem. This runs on every webhook request.
func BenchmarkSecretCache_GetSecrets_CacheHit(b *testing.B) {
	tokenPath, subIDPath := writeBenchSecrets(b)
	cache := env.NewSecretCache(tokenPath, subIDPath, 10*time.Minute, gcplog.NewNoOpLogger())
	// Prime the cache so every measured call takes the within-TTL fast path.
	if _, _, err := cache.GetSecrets(); err != nil {
		b.Fatalf("prime cache: %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, err := cache.GetSecrets(); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSecretCache_GetSecrets_CacheMiss measures the TTL-expiry re-check
// path: ttl=0 forces every call past the fast path to take the write lock and
// re-hash both files to detect changes (content is unchanged here, so no
// reload). This is the recurring cost paid once per TTL interval in
// production, dominated by the two file reads + SHA256.
func BenchmarkSecretCache_GetSecrets_CacheMiss(b *testing.B) {
	tokenPath, subIDPath := writeBenchSecrets(b)
	cache := env.NewSecretCache(tokenPath, subIDPath, 0, gcplog.NewNoOpLogger())
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, err := cache.GetSecrets(); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSecretCache_GetSecrets_Concurrent measures cache-hit throughput
// under concurrent readers — the realistic shape, since the dispatcher serves
// webhooks concurrently and each one calls GetSecrets. Exercises read-lock
// contention on the fast path.
func BenchmarkSecretCache_GetSecrets_Concurrent(b *testing.B) {
	tokenPath, subIDPath := writeBenchSecrets(b)
	cache := env.NewSecretCache(tokenPath, subIDPath, 10*time.Minute, gcplog.NewNoOpLogger())
	if _, _, err := cache.GetSecrets(); err != nil {
		b.Fatalf("prime cache: %v", err)
	}
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, _, err := cache.GetSecrets(); err != nil {
				b.Fatal(err)
			}
		}
	})
}
