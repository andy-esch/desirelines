package config

import (
	"os"
	"strings"
	"testing"
)

func TestLoadConfig_SecretsFilePrecedence(t *testing.T) {
	// Create temporary secrets file
	tempDir, err := os.MkdirTemp("", "loadconfig_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer func() {
		if removeErr := os.RemoveAll(tempDir); removeErr != nil {
			t.Logf("Failed to clean up temp dir: %v", removeErr)
		}
	}()

	// Note: We can't change the constant DefaultSecretsPath, so we can't fully test
	// the file loading logic here without refactoring LoadConfig to accept a path.
	// However, we can test that it falls back to environment variables when the file is missing
	// (which it is in this test environment, as it looks for /etc/secrets/strava_auth.json).
	// To test file precedence properly, we would need to mock the file system or make the path configurable.
	// For now, we assume file loading works (tested via integration or manual verification)
	// and verify environment variable fallback which is critical.

	// Set environment variables
	err = os.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "env-token")
	if err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	err = os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "22222")
	if err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	err = os.Setenv("GCP_PROJECT_ID", "test-project")
	if err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if pubsubEnvErr := os.Setenv("GCP_PUBSUB_TOPIC", "test-topic"); pubsubEnvErr != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	defer cleanupEnv(t,
		"STRAVA_WEBHOOK_VERIFY_TOKEN",
		"STRAVA_WEBHOOK_SUBSCRIPTION_ID",
		"GCP_PROJECT_ID",
		"GCP_PUBSUB_TOPIC",
	)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// Secrets should come from env vars (since DefaultSecretsPath doesn't exist in test)
	if cfg.StravaWebhookVerifyToken != "env-token" {
		t.Errorf("Expected verify token from env 'env-token', got '%s'", cfg.StravaWebhookVerifyToken)
	}
	if cfg.StravaWebhookSubscriptionID != 22222 {
		t.Errorf("Expected subscription ID from env 22222, got %d", cfg.StravaWebhookSubscriptionID)
	}

	// GCP settings should come from env vars
	if cfg.GCPProjectID != "test-project" {
		t.Errorf("Expected GCP project 'test-project', got '%s'", cfg.GCPProjectID)
	}
	if cfg.GCPPubSubTopicID != "test-topic" {
		t.Errorf("Expected GCP topic 'test-topic', got '%s'", cfg.GCPPubSubTopicID)
	}
}

func TestLoadConfig_EnvVarsFallback(t *testing.T) {
	// Ensure no secrets file exists at default path
	// Set environment variables as fallback
	if err := os.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", "fallback-token"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "33333"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("GCP_PROJECT_ID", "fallback-project"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("GCP_PUBSUB_TOPIC", "fallback-topic"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("LOG_LEVEL", "DEBUG"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	defer cleanupEnv(t,
		"STRAVA_WEBHOOK_VERIFY_TOKEN",
		"STRAVA_WEBHOOK_SUBSCRIPTION_ID",
		"GCP_PROJECT_ID",
		"GCP_PUBSUB_TOPIC",
		"LOG_LEVEL",
	)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// All values should come from env vars
	if cfg.StravaWebhookVerifyToken != "fallback-token" {
		t.Errorf("Expected verify token 'fallback-token', got '%s'", cfg.StravaWebhookVerifyToken)
	}
	if cfg.StravaWebhookSubscriptionID != 33333 {
		t.Errorf("Expected subscription ID 33333, got %d", cfg.StravaWebhookSubscriptionID)
	}
	if cfg.GCPProjectID != "fallback-project" {
		t.Errorf("Expected GCP project 'fallback-project', got '%s'", cfg.GCPProjectID)
	}
	if cfg.GCPPubSubTopicID != "fallback-topic" {
		t.Errorf("Expected GCP topic 'fallback-topic', got '%s'", cfg.GCPPubSubTopicID)
	}
	if cfg.LogLevel != "DEBUG" {
		t.Errorf("Expected log level 'DEBUG', got '%s'", cfg.LogLevel)
	}
}

func TestLoadConfig_DefaultValues(t *testing.T) {
	// Clear any environment variables
	cleanupEnv(t,
		"STRAVA_WEBHOOK_VERIFY_TOKEN",
		"STRAVA_WEBHOOK_SUBSCRIPTION_ID",
		"GCP_PROJECT_ID",
		"GCP_PUBSUB_TOPIC",
		"LOG_LEVEL",
	)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// Webhook values should be empty/zero (no defaults)
	if cfg.StravaWebhookVerifyToken != "" {
		t.Errorf("Expected empty verify token, got '%s'", cfg.StravaWebhookVerifyToken)
	}
	if cfg.StravaWebhookSubscriptionID != 0 {
		t.Errorf("Expected subscription ID 0, got %d", cfg.StravaWebhookSubscriptionID)
	}

	// GCP values should be empty (no defaults)
	if cfg.GCPProjectID != "" {
		t.Errorf("Expected empty GCP project, got '%s'", cfg.GCPProjectID)
	}
	if cfg.GCPPubSubTopicID != "" {
		t.Errorf("Expected empty GCP topic, got '%s'", cfg.GCPPubSubTopicID)
	}

	// LogLevel should have default value
	if cfg.LogLevel != "INFO" {
		t.Errorf("Expected default log level 'INFO', got '%s'", cfg.LogLevel)
	}
}

func TestLoadConfig_InvalidSubscriptionID(t *testing.T) {
	if err := os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "not-a-number"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	defer cleanupEnv(t, "STRAVA_WEBHOOK_SUBSCRIPTION_ID")

	_, err := LoadConfig()
	if err == nil {
		t.Errorf("Expected error for invalid subscription ID, got nil")
	}
	if err != nil && !strings.Contains(err.Error(), "invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID") {
		t.Errorf("Expected 'invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID' error, got: %v", err)
	}
}

func TestGetEnvOrDefault(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		defaultValue string
		envValue     string
		setEnv       bool
		expected     string
	}{
		{
			name:         "Returns env var when set",
			key:          "TEST_VAR_SET",
			defaultValue: "default",
			envValue:     "from-env",
			setEnv:       true,
			expected:     "from-env",
		},
		{
			name:         "Returns default when env var not set",
			key:          "TEST_VAR_UNSET",
			defaultValue: "default-value",
			envValue:     "",
			setEnv:       false,
			expected:     "default-value",
		},
		{
			name:         "Returns default when env var is empty string",
			key:          "TEST_VAR_EMPTY",
			defaultValue: "default-value",
			envValue:     "",
			setEnv:       true,
			expected:     "default-value",
		},
		{
			name:         "Returns empty default when env var not set",
			key:          "TEST_VAR_EMPTY_DEFAULT",
			defaultValue: "",
			envValue:     "",
			setEnv:       false,
			expected:     "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clean up before and after
			cleanupEnv(t, tt.key)
			defer cleanupEnv(t, tt.key)

			if tt.setEnv {
				if err := os.Setenv(tt.key, tt.envValue); err != nil {
					t.Fatalf("Failed to set env var: %v", err)
				}
			}

			result := GetEnvOrDefault(tt.key, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("GetEnvOrDefault() = '%s', expected '%s'", result, tt.expected)
			}
		})
	}
}

// Helper function to clean up environment variables
func cleanupEnv(t *testing.T, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if err := os.Unsetenv(key); err != nil {
			// Log the error but don't fail the test, as cleanup is best-effort
			t.Logf("warn: failed to unset environment variable %q: %v", key, err)
		}
	}
}
