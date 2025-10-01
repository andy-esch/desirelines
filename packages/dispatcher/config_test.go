package dispatcher

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSecretCache_GetSecrets(t *testing.T) {
	// Create a temporary directory for test files
	tempDir, err := os.MkdirTemp("", "secret_cache_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "strava_auth.json")

	// Create initial secrets file
	initialSecrets := map[string]any{
		"webhook_verify_token":    "initial-token",
		"webhook_subscription_id": 12345,
	}
	writeSecretsFile(t, secretsPath, initialSecrets)

	// Create cache with short TTL for testing
	cache := NewSecretCache(secretsPath, 100*time.Millisecond)

	// First call should load from file
	verifyToken, subscriptionID, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if verifyToken != "initial-token" {
		t.Errorf("Expected verify token 'initial-token', got '%s'", verifyToken)
	}
	if subscriptionID != 12345 {
		t.Errorf("Expected subscription ID 12345, got %d", subscriptionID)
	}

	// Second call within TTL should use cache (same values)
	verifyToken2, subscriptionID2, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error on cached call, got %v", err)
	}
	if verifyToken2 != verifyToken || subscriptionID2 != subscriptionID {
		t.Errorf("Cached values don't match initial values")
	}

	// Update secrets file with new content
	updatedSecrets := map[string]any{
		"webhook_verify_token":    "updated-token",
		"webhook_subscription_id": 67890,
	}
	writeSecretsFile(t, secretsPath, updatedSecrets)

	// Call within TTL should still return cached values
	verifyToken3, subscriptionID3, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error within TTL, got %v", err)
	}
	if verifyToken3 != "initial-token" || subscriptionID3 != 12345 {
		t.Errorf("Expected cached values within TTL, got token='%s', id=%d", verifyToken3, subscriptionID3)
	}

	// Wait for TTL to expire
	time.Sleep(150 * time.Millisecond)

	// Call after TTL should detect change and return new values
	verifyToken4, subscriptionID4, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error after TTL, got %v", err)
	}
	if verifyToken4 != "updated-token" {
		t.Errorf("Expected updated token 'updated-token', got '%s'", verifyToken4)
	}
	if subscriptionID4 != 67890 {
		t.Errorf("Expected updated subscription ID 67890, got %d", subscriptionID4)
	}
}

func TestSecretCache_FileNotFound(t *testing.T) {
	cache := NewSecretCache("/nonexistent/path/secrets.json", time.Minute)

	_, _, err := cache.GetSecrets()
	if err == nil {
		t.Errorf("Expected error for nonexistent file, got nil")
	}
}

func TestSecretCache_InvalidJSON(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "secret_cache_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "invalid.json")

	// Write invalid JSON
	err = os.WriteFile(secretsPath, []byte("invalid json content"), 0644)
	if err != nil {
		t.Fatalf("Failed to write invalid JSON file: %v", err)
	}

	cache := NewSecretCache(secretsPath, time.Minute)

	_, _, err = cache.GetSecrets()
	if err == nil {
		t.Errorf("Expected error for invalid JSON, got nil")
	}
}

func TestSecretCache_FallbackToCachedValues(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "secret_cache_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "strava_auth.json")

	// Create initial valid secrets file
	initialSecrets := map[string]any{
		"webhook_verify_token":    "cached-token",
		"webhook_subscription_id": 11111,
	}
	writeSecretsFile(t, secretsPath, initialSecrets)

	cache := NewSecretCache(secretsPath, 100*time.Millisecond)

	// Load initial values
	verifyToken, subscriptionID, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error on initial load, got %v", err)
	}
	if verifyToken != "cached-token" || subscriptionID != 11111 {
		t.Errorf("Expected initial values, got token='%s', id=%d", verifyToken, subscriptionID)
	}

	// Delete the file to simulate temporary file system issue
	os.Remove(secretsPath)

	// Wait for TTL to expire
	time.Sleep(150 * time.Millisecond)

	// Should fallback to cached values despite file being gone
	verifyToken2, subscriptionID2, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected fallback to work, got error %v", err)
	}
	if verifyToken2 != "cached-token" || subscriptionID2 != 11111 {
		t.Errorf("Expected fallback to cached values, got token='%s', id=%d", verifyToken2, subscriptionID2)
	}
}

func TestSecretCache_ContentHashDetection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "secret_cache_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "strava_auth.json")

	// Create initial secrets file
	initialSecrets := map[string]any{
		"webhook_verify_token":    "hash-test-token",
		"webhook_subscription_id": 99999,
	}
	writeSecretsFile(t, secretsPath, initialSecrets)

	cache := NewSecretCache(secretsPath, 50*time.Millisecond) // Short TTL for testing

	// Load initial values
	verifyToken, subscriptionID, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error on initial load, got %v", err)
	}
	if verifyToken != "hash-test-token" || subscriptionID != 99999 {
		t.Errorf("Expected initial hash test values, got token='%s', id=%d", verifyToken, subscriptionID)
	}

	// Update file content (different values, same file)
	updatedSecrets := map[string]any{
		"webhook_verify_token":    "new-hash-token",
		"webhook_subscription_id": 88888,
	}
	writeSecretsFile(t, secretsPath, updatedSecrets)

	// Wait for TTL to expire so hash check happens
	time.Sleep(60 * time.Millisecond)

	// After TTL expires, hash change should trigger reload
	verifyToken2, subscriptionID2, err := cache.GetSecrets()
	if err != nil {
		t.Errorf("Expected no error after content change, got %v", err)
	}
	if verifyToken2 != "new-hash-token" {
		t.Errorf("Expected new token 'new-hash-token', got '%s'", verifyToken2)
	}
	if subscriptionID2 != 88888 {
		t.Errorf("Expected new subscription ID 88888, got %d", subscriptionID2)
	}
}

// Helper function to write secrets file
func writeSecretsFile(t *testing.T, path string, secrets map[string]any) {
	data, err := json.Marshal(secrets)
	if err != nil {
		t.Fatalf("Failed to marshal secrets: %v", err)
	}

	err = os.WriteFile(path, data, 0644)
	if err != nil {
		t.Fatalf("Failed to write secrets file: %v", err)
	}
}
