package config

import (
	"os"
	"testing"
)

func TestLoadConfig_EnvVars(t *testing.T) {
	// Set environment variables
	if err := os.Setenv("GCP_PROJECT_ID", "test-project"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("GCP_PUBSUB_TOPIC", "test-topic"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	if err := os.Setenv("LOG_LEVEL", "DEBUG"); err != nil {
		t.Fatalf("Failed to set env var: %v", err)
	}
	defer cleanupEnv(t,
		"GCP_PROJECT_ID",
		"GCP_PUBSUB_TOPIC",
		"LOG_LEVEL",
	)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if cfg.GCPProjectID != "test-project" {
		t.Errorf("Expected GCP project 'test-project', got '%s'", cfg.GCPProjectID)
	}
	if cfg.GCPPubSubTopicID != "test-topic" {
		t.Errorf("Expected GCP topic 'test-topic', got '%s'", cfg.GCPPubSubTopicID)
	}
	if cfg.LogLevel != "DEBUG" {
		t.Errorf("Expected log level 'DEBUG', got '%s'", cfg.LogLevel)
	}
}

func TestLoadConfig_DefaultValues(t *testing.T) {
	// Clear any environment variables
	cleanupEnv(t,
		"GCP_PROJECT_ID",
		"GCP_PUBSUB_TOPIC",
		"LOG_LEVEL",
	)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
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
