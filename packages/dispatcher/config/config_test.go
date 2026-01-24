package config

import (
	"os"
	"testing"
	"time"
)

// unsetEnv unsets an environment variable and restores it after the test.
func unsetEnv(t *testing.T, key string) {
	t.Helper()
	prev, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("Failed to unset env var %s: %v", key, err)
	}
	t.Cleanup(func() {
		if existed {
			if err := os.Setenv(key, prev); err != nil {
				t.Fatalf("Failed to restore env var %s: %v", key, err)
			}
		}
	})
}

func TestLoadConfig_EnvVars(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("LOG_LEVEL", "DEBUG")

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
	// Clear optional env vars to test defaults
	unsetEnv(t, "LOG_LEVEL")
	unsetEnv(t, "HTTP_READ_TIMEOUT")
	unsetEnv(t, "HTTP_WRITE_TIMEOUT")
	unsetEnv(t, "HTTP_READ_HEADER_TIMEOUT")
	unsetEnv(t, "MAX_REQUEST_BODY_SIZE")

	// Set required env vars
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// LogLevel should have default value
	if cfg.LogLevel != "INFO" {
		t.Errorf("Expected default log level 'INFO', got '%s'", cfg.LogLevel)
	}

	// Timeouts should have default values
	if cfg.ReadTimeout != DefaultReadTimeout {
		t.Errorf("Expected default read timeout %v, got %v", DefaultReadTimeout, cfg.ReadTimeout)
	}
	if cfg.WriteTimeout != DefaultWriteTimeout {
		t.Errorf("Expected default write timeout %v, got %v", DefaultWriteTimeout, cfg.WriteTimeout)
	}
	if cfg.ReadHeaderTimeout != DefaultReadHeaderTimeout {
		t.Errorf("Expected default read header timeout %v, got %v", DefaultReadHeaderTimeout, cfg.ReadHeaderTimeout)
	}

	// Max body size should have default value
	if cfg.MaxRequestBodySize != DefaultMaxRequestBodySize {
		t.Errorf("Expected default max body size %d, got %d", DefaultMaxRequestBodySize, cfg.MaxRequestBodySize)
	}
}

func TestLoadConfig_MissingGCPProjectID(t *testing.T) {
	unsetEnv(t, "GCP_PROJECT_ID")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for missing GCP_PROJECT_ID, got nil")
	}
	if err != nil && err.Error() != "required environment variable GCP_PROJECT_ID is not set" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestLoadConfig_MissingGCPPubSubTopic(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	unsetEnv(t, "GCP_PUBSUB_TOPIC")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for missing GCP_PUBSUB_TOPIC, got nil")
	}
	if err != nil && err.Error() != "required environment variable GCP_PUBSUB_TOPIC is not set" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestLoadConfig_CustomTimeouts(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("HTTP_READ_TIMEOUT", "45s")
	t.Setenv("HTTP_WRITE_TIMEOUT", "1m")
	t.Setenv("HTTP_READ_HEADER_TIMEOUT", "15s")
	t.Setenv("MAX_REQUEST_BODY_SIZE", "2097152") // 2MB

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if cfg.ReadTimeout != 45*time.Second {
		t.Errorf("Expected read timeout 45s, got %v", cfg.ReadTimeout)
	}
	if cfg.WriteTimeout != time.Minute {
		t.Errorf("Expected write timeout 1m, got %v", cfg.WriteTimeout)
	}
	if cfg.ReadHeaderTimeout != 15*time.Second {
		t.Errorf("Expected read header timeout 15s, got %v", cfg.ReadHeaderTimeout)
	}
	if cfg.MaxRequestBodySize != 2097152 {
		t.Errorf("Expected max body size 2097152, got %d", cfg.MaxRequestBodySize)
	}
}

func TestLoadConfig_InvalidTimeout(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("HTTP_READ_TIMEOUT", "invalid")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for invalid timeout, got nil")
	}
}

func TestLoadConfig_NegativeTimeout(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("HTTP_READ_TIMEOUT", "-5s")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for negative timeout, got nil")
	}
}

func TestLoadConfig_InvalidBodySize(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("MAX_REQUEST_BODY_SIZE", "not-a-number")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for invalid body size, got nil")
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
			// Ensure clean state
			unsetEnv(t, tt.key)

			if tt.setEnv {
				t.Setenv(tt.key, tt.envValue)
			}

			result := GetEnvOrDefault(tt.key, tt.defaultValue)
			if result != tt.expected {
				t.Errorf("GetEnvOrDefault() = '%s', expected '%s'", result, tt.expected)
			}
		})
	}
}
