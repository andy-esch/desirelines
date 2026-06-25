package env_test

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// countingHandler is a minimal slog.Handler that tallies records by level so a
// test can assert how often GetSecrets logs on a fault path. Single-goroutine
// use only (the tests below call GetSecrets sequentially).
type countingHandler struct {
	warns  int
	errors int
}

func (h *countingHandler) Enabled(context.Context, slog.Level) bool { return true }

// Handle takes slog.Record by value because the slog.Handler interface requires
// it; gocritic's hugeParam doesn't apply to an interface-mandated signature.
func (h *countingHandler) Handle(_ context.Context, r slog.Record) error { //nolint:gocritic // slog.Handler interface signature
	switch r.Level {
	case slog.LevelWarn:
		h.warns++
	case slog.LevelError:
		h.errors++
	default:
		// Debug/Info levels aren't asserted on by these tests.
	}
	return nil
}

func (h *countingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *countingHandler) WithGroup(string) slog.Handler      { return h }

// setupTempSecrets creates a temp directory with secret files and returns cleanup func.
func setupTempSecrets(t *testing.T, token, subID string) (tokenPath, subIDPath string, cleanup func()) {
	t.Helper()

	tempDir, createErr := os.MkdirTemp("", "secret_cache_test")
	if createErr != nil {
		t.Fatalf("Failed to create temp dir: %v", createErr)
	}

	tokenPath = filepath.Join(tempDir, "VERIFY_TOKEN")
	subIDPath = filepath.Join(tempDir, "SUBSCRIPTION_ID")

	if writeErr := os.WriteFile(tokenPath, []byte(token), 0o600); writeErr != nil {
		t.Fatalf("Failed to write verify token: %v", writeErr)
	}
	if writeErr := os.WriteFile(subIDPath, []byte(subID), 0o600); writeErr != nil {
		t.Fatalf("Failed to write subscription id: %v", writeErr)
	}

	cleanup = func() {
		if removeErr := os.RemoveAll(tempDir); removeErr != nil {
			t.Logf("Failed to clean up temp dir: %v", removeErr)
		}
	}
	return tokenPath, subIDPath, cleanup
}

func TestSecretCache_InitialLoad(t *testing.T) {
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "initial-token", "12345")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, log)

	verifyToken, subscriptionID, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if verifyToken != "initial-token" {
		t.Errorf("Expected verify token 'initial-token', got '%s'", verifyToken)
	}
	if subscriptionID != 12345 {
		t.Errorf("Expected subscription ID 12345, got %d", subscriptionID)
	}
}

func TestSecretCache_CachedWithinTTL(t *testing.T) {
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "initial-token", "99999")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, log)

	// First call loads from files
	token1, subID1, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Second call within TTL should use cache
	token2, subID2, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error on cached call, got %v", err)
	}
	if token2 != token1 || subID2 != subID1 {
		t.Errorf("Cached values don't match initial values")
	}
}

func TestSecretCache_ReloadsAfterTTL(t *testing.T) {
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "initial-token", "12345")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	// Use a longer TTL than most tests — the "within TTL" assertion below races
	// against initial-load IO + file-write latency. Short TTLs (100ms) make this
	// flaky on slow CI runners where those operations exceed the window.
	cache := env.NewSecretCache(tokenPath, subIDPath, 500*time.Millisecond, log)

	// Load initial values
	_, _, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error on initial load, got %v", err)
	}

	// Update the token file
	if writeErr := os.WriteFile(tokenPath, []byte("updated-token"), 0o600); writeErr != nil {
		t.Fatalf("Failed to update verify token: %v", writeErr)
	}

	// Call within TTL should still return cached values
	token, subID, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error within TTL, got %v", err)
	}
	if token != "initial-token" || subID != 12345 {
		t.Errorf("Expected cached values within TTL, got token='%s', id=%d", token, subID)
	}

	// Wait for TTL to expire
	time.Sleep(600 * time.Millisecond)

	// Call after TTL should detect change
	token, subID, err = cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error after TTL, got %v", err)
	}
	if token != "updated-token" {
		t.Errorf("Expected updated token 'updated-token', got '%s'", token)
	}
	if subID != 12345 {
		t.Errorf("Expected subscription ID 12345 unchanged, got %d", subID)
	}
}

func TestSecretCache_DetectsSubscriptionIDChange(t *testing.T) {
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "token", "12345")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, log)

	// Load initial values
	_, subID1, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if subID1 != 12345 {
		t.Fatalf("Expected initial subscription ID 12345, got %d", subID1)
	}

	// Update subscription ID
	if writeErr := os.WriteFile(subIDPath, []byte("67890"), 0o600); writeErr != nil {
		t.Fatalf("Failed to update subscription id: %v", writeErr)
	}

	// Wait for TTL
	time.Sleep(150 * time.Millisecond)

	// Should detect change
	_, subID2, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if subID2 != 67890 {
		t.Errorf("Expected updated subscription ID 67890, got %d", subID2)
	}
}

func TestSecretCache_FileNotFound_EnvFallback(t *testing.T) {
	// Set environment variables as fallback
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "env-fallback-token")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "54321")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/nonexistent/path/token", "/nonexistent/path/id", time.Minute, log)

	verifyToken, subscriptionID, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected env fallback to work, got error %v", err)
	}
	const expectedToken = "env-fallback-token" //nolint:gosec // Test constant, not a credential
	if verifyToken != expectedToken {
		t.Errorf("Expected env fallback token '%s', got '%s'", expectedToken, verifyToken)
	}
	if subscriptionID != 54321 {
		t.Errorf("Expected env fallback subscription ID 54321, got %d", subscriptionID)
	}
}

func TestSecretCache_EnvOverridesAfterFilesMissing(t *testing.T) {
	// First set up with invalid env to test that files take precedence
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "not-a-number")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/nonexistent/token", "/nonexistent/subid", time.Minute, log)

	// Now set valid env vars - these should be used since files don't exist
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "env-token")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "999")

	token, subID, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected fallback to env, got error: %v", err)
	}
	if token != "env-token" || subID != 999 {
		t.Errorf("Expected fallback values, got token=%s, id=%d", token, subID)
	}
}

func TestSecretCache_InvalidSubscriptionID(t *testing.T) {
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "token", "not-a-number")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, time.Minute, log)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Errorf("Expected error for invalid subscription ID integer, got nil")
	}
}

func TestSecretCache_LoadSecretsFromEnv_Success(t *testing.T) {
	// Use /dev/null/invalid paths so hashFiles fails with ENOTDIR (not ENOENT),
	// which triggers the loadSecretsFromEnv fallback in GetSecrets.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "env-token-direct")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "77777")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	token, subID, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected loadSecretsFromEnv to succeed, got error: %v", err)
	}
	const expectedDirectToken = "env-token-direct" //nolint:gosec // Test constant, not a credential
	if token != expectedDirectToken {
		t.Errorf("Expected token '%s', got '%s'", expectedDirectToken, token)
	}
	if subID != 77777 {
		t.Errorf("Expected subscription ID 77777, got %d", subID)
	}
}

func TestSecretCache_LoadSecretsFromEnv_InvalidSubID(t *testing.T) {
	// hashFiles fails (ENOTDIR), no cache, env has non-numeric subscription ID.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "some-token")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "not-a-number")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatal("Expected error for non-numeric subscription ID from env, got nil")
	}
}

func TestSecretCache_LoadSecretsFromEnv_MissingSubID(t *testing.T) {
	// hashFiles fails (ENOTDIR), no cache, STRAVA_WEBHOOK_SUBSCRIPTION_ID not set.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "some-token")
	// Set to empty string to simulate unset (GetEnvOrDefault treats "" as unset)
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatal("Expected error when subscription ID is missing from env, got nil")
	}
}

// TestSecretCache_LoadSecretsFromEnv_PartialFailureDoesNotCacheVerifyToken
// pins the no-partial-update invariant: if env-fallback fails partway
// through (valid verifyToken but invalid subscriptionID), the cache must
// not retain the fresh verifyToken — otherwise GetSecrets's "use cached
// values if available" fallback would return a mismatched (new token,
// stale subID) pair without surfacing the error.
func TestSecretCache_LoadSecretsFromEnv_PartialFailureDoesNotCacheVerifyToken(t *testing.T) {
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "fresh-token")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "not-a-number")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	// First call: subID parse fails. We expect an error AND no cached state.
	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatal("Expected error for invalid subscription ID, got nil")
	}

	// Second call: still failing inputs. If the first call had cached the
	// verifyToken, the cached-fallback branch would now silently return
	// it with subscriptionID=0. Demand the same error instead.
	token, subID, err := cache.GetSecrets()
	if err == nil {
		t.Fatalf("Expected error on second call; got cached state (token=%q, subID=%d)", token, subID)
	}
}

func TestSecretCache_HashFailsNoCacheFallbackToEnvFails(t *testing.T) {
	// First call: hashFiles fails, no cached values, env vars not set -> error.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatal("Expected error when hash fails and env vars are missing, got nil")
	}
}

func TestSecretCache_ContentChangedButReloadFails_UsesCached(t *testing.T) {
	// Clear env so that loadSecrets env fallback fails when files become invalid.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "good-token", "42")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, log)

	// Initial load succeeds from files.
	token, subID, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected initial load to succeed, got %v", err)
	}
	if token != "good-token" || subID != 42 {
		t.Fatalf("Initial values wrong: token=%s, id=%d", token, subID)
	}

	// Corrupt the subscription ID file so loadSecrets fails on reload.
	if writeErr := os.WriteFile(subIDPath, []byte("not-a-number"), 0o600); writeErr != nil {
		t.Fatalf("Failed to corrupt subscription id file: %v", writeErr)
	}

	// Wait for TTL to expire.
	time.Sleep(150 * time.Millisecond)

	// Content hash changed (file was modified), loadSecrets fails, but cached values exist.
	// Should log Warn and return cached values.
	token, subID, err = cache.GetSecrets()
	if err != nil {
		t.Fatalf("Expected cached fallback, got error: %v", err)
	}
	if token != "good-token" {
		t.Errorf("Expected cached token 'good-token', got '%s'", token)
	}
	if subID != 42 {
		t.Errorf("Expected cached subscription ID 42, got %d", subID)
	}
}

func TestSecretCache_SubscriptionIDOutOfRange(t *testing.T) {
	// Value exceeds math.MaxInt32 (2147483647)
	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "token", "2147483648")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subIDPath, time.Minute, log)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatal("Expected error for subscription ID > MaxInt32, got nil")
	}
}

func TestSecretCache_FallbackToCachedValues(t *testing.T) {
	// Clear env vars so fallback to env fails and cached values are used
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	tokenPath, subPath, cleanup := setupTempSecrets(t, "cached-token", "11111")
	defer cleanup()

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache(tokenPath, subPath, 100*time.Millisecond, log)

	// Load initial values
	_, _, err := cache.GetSecrets()
	if err != nil {
		t.Fatalf("Failed to load initial secrets: %v", err)
	}

	// Delete the files
	if removeErr := os.Remove(tokenPath); removeErr != nil {
		t.Fatalf("Failed to remove token file: %v", removeErr)
	}
	if removeErr := os.Remove(subPath); removeErr != nil {
		t.Fatalf("Failed to remove subscription id file: %v", removeErr)
	}

	// Wait for TTL
	time.Sleep(150 * time.Millisecond)

	// Should fallback to cached values
	token, id, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected fallback to work, got error %v", err)
	}
	if token != "cached-token" || id != 11111 {
		t.Errorf("Expected fallback to cached values, got token=%s, id=%d", token, id)
	}
}

// TestSecretCache_RejectsEmptyVerifyTokenFile pins the H1 fix: a verify
// token file that contains only whitespace (truncated deploy, accidental
// newline-only file, mis-rendered Secret Manager mount) must produce an
// error rather than caching "" — otherwise subtle.ConstantTimeCompare
// in handleVerification would return 1 for empty-vs-empty and any caller
// could echo back hub.challenge.
func TestSecretCache_RejectsEmptyVerifyTokenFile(t *testing.T) {
	// Clear env so the loader can't recover by falling back to env.
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	cases := []struct {
		name    string
		content string
	}{
		{"empty file", ""},
		{"whitespace only", "   \n\t  \n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tokenPath, subIDPath, cleanup := setupTempSecrets(t, tc.content, "42")
			defer cleanup()

			log := gcplog.NewNoOpLogger()
			cache := env.NewSecretCache(tokenPath, subIDPath, time.Minute, log)

			token, _, err := cache.GetSecrets()
			if err == nil {
				t.Fatalf("Expected error for %s verify token file, got token=%q nil err", tc.name, token)
			}
			if token != "" {
				t.Errorf("Empty/whitespace verify token leaked through cache: got %q", token)
			}
		})
	}
}

// TestSecretCache_RejectsEmptyVerifyTokenEnv is the env-fallback counterpart
// of the H1 fix: when the verify token file is missing and the env var is
// unset/empty, the loader must error instead of caching "".
func TestSecretCache_RejectsEmptyVerifyTokenEnv(t *testing.T) {
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "42")

	log := gcplog.NewNoOpLogger()
	cache := env.NewSecretCache("/dev/null/invalid_token", "/dev/null/invalid_sub", time.Minute, log)

	token, _, err := cache.GetSecrets()
	if err == nil {
		t.Fatalf("Expected error for empty STRAVA_WEBHOOK_VERIFY_TOKEN, got token=%q nil err", token)
	}
	if token != "" {
		t.Errorf("Empty env verify token leaked through cache: got %q", token)
	}
}

// TestSecretCache_PersistentReloadFault_BacksOff pins M1 + L1(06-24) for the
// reload-fault branch: once GetSecrets serves cached values after a failed
// reload it advances lastCheck, so a burst of follow-up requests within the TTL
// take the fast path instead of re-hashing + reloading + re-logging under the
// write lock on every call. On the unfixed code lastCheck never advances, so
// every call re-runs the fault path (6 warns instead of 1).
func TestSecretCache_PersistentReloadFault_BacksOff(t *testing.T) {
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "good-token", "42")
	defer cleanup()

	counter := &countingHandler{}
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, slog.New(counter))

	// Initial load succeeds and caches good values.
	if _, _, err := cache.GetSecrets(); err != nil {
		t.Fatalf("initial load failed: %v", err)
	}

	// Corrupt the subscription ID file so every reload fails.
	if err := os.WriteFile(subIDPath, []byte("not-a-number"), 0o600); err != nil {
		t.Fatalf("corrupt sub id file: %v", err)
	}

	// Expire the TTL so the next call takes the slow path and hits the fault.
	time.Sleep(150 * time.Millisecond)

	// First post-fault call: reload fails, logs once, serves cached, and gates.
	if tok, _, err := cache.GetSecrets(); err != nil || tok != "good-token" {
		t.Fatalf("first post-fault call: expected cached fallback, got token=%q err=%v", tok, err)
	}

	// Burst of immediate follow-ups, all well within the TTL: must NOT re-hash
	// or re-log — they take the fast path on the freshly advanced lastCheck.
	for i := range 5 {
		if tok, _, err := cache.GetSecrets(); err != nil || tok != "good-token" {
			t.Fatalf("burst call %d: expected cached fallback, got token=%q err=%v", i, tok, err)
		}
	}

	if counter.warns != 1 {
		t.Errorf("expected exactly 1 reload-fault warn (backed off for one TTL), got %d — "+
			"fault path is re-hashing + re-logging per request", counter.warns)
	}
}

// TestSecretCache_PersistentHashFault_BacksOff pins L1(06-24) for the
// hash-error branch: a persistent hashFiles() failure with cached values present
// must likewise advance lastCheck so it doesn't re-hash + re-log every request.
// A directory at the secret path makes hashFiles fail deterministically
// (os.Open succeeds, io.Copy fails with "is a directory") on every OS.
func TestSecretCache_PersistentHashFault_BacksOff(t *testing.T) {
	t.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	t.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")

	tokenPath, subIDPath, cleanup := setupTempSecrets(t, "good-token", "42")
	defer cleanup()

	counter := &countingHandler{}
	cache := env.NewSecretCache(tokenPath, subIDPath, 100*time.Millisecond, slog.New(counter))

	// Initial load succeeds and caches good values.
	if _, _, err := cache.GetSecrets(); err != nil {
		t.Fatalf("initial load failed: %v", err)
	}

	// Replace the token file with a directory so hashFiles() errors persistently.
	if err := os.Remove(tokenPath); err != nil {
		t.Fatalf("remove token file: %v", err)
	}
	if err := os.Mkdir(tokenPath, 0o700); err != nil {
		t.Fatalf("mkdir over token path: %v", err)
	}

	// Expire the TTL so the next call takes the slow path and hits the fault.
	time.Sleep(150 * time.Millisecond)

	// First post-fault call: hash fails, logs once, serves cached, and gates.
	if tok, _, err := cache.GetSecrets(); err != nil || tok != "good-token" {
		t.Fatalf("first post-fault call: expected cached fallback, got token=%q err=%v", tok, err)
	}

	// Burst of immediate follow-ups within the TTL: fast path, no re-hash/re-log.
	for i := range 5 {
		if tok, _, err := cache.GetSecrets(); err != nil || tok != "good-token" {
			t.Fatalf("burst call %d: expected cached fallback, got token=%q err=%v", i, tok, err)
		}
	}

	if counter.errors != 1 {
		t.Errorf("expected exactly 1 hash-fault error log (backed off for one TTL), got %d — "+
			"fault path is re-hashing + re-logging per request", counter.errors)
	}
}
