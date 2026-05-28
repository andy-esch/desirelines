package env_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

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
