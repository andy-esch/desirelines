package config

import (
	"log/slog"
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
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")

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
	if cfg.GCPPubSubDeauthTopicID != "test-deauth-topic" {
		t.Errorf("Expected GCP deauth topic 'test-deauth-topic', got '%s'", cfg.GCPPubSubDeauthTopicID)
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
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
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

func TestLoadConfig_MissingDeauthTopic(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	unsetEnv(t, "GCP_PUBSUB_DEAUTH_TOPIC")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for missing GCP_PUBSUB_DEAUTH_TOPIC, got nil")
	}
	if err != nil && err.Error() != "required environment variable GCP_PUBSUB_DEAUTH_TOPIC is not set" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestLoadConfig_MissingFirestoreDatabase(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	unsetEnv(t, "FIRESTORE_DATABASE")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for missing FIRESTORE_DATABASE, got nil")
	}
	if err != nil && err.Error() != "required environment variable FIRESTORE_DATABASE is not set" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestLoadConfig_CustomTimeouts(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")
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
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")
	t.Setenv("HTTP_READ_TIMEOUT", "invalid")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for invalid timeout, got nil")
	}
}

func TestLoadConfig_NegativeTimeout(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")
	t.Setenv("HTTP_READ_TIMEOUT", "-5s")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for negative timeout, got nil")
	}
}

func TestLoadConfig_InvalidBodySize(t *testing.T) {
	t.Setenv("GCP_PROJECT_ID", "test-project")
	t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
	t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
	t.Setenv("FIRESTORE_DATABASE", "test-db")
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

func TestParseLogLevel(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		setEnv   bool
		expected slog.Level
	}{
		{"DEBUG", "DEBUG", true, slog.LevelDebug},
		{"INFO", "INFO", true, slog.LevelInfo},
		{"WARN", "WARN", true, slog.LevelWarn},
		{"ERROR", "ERROR", true, slog.LevelError},
		{"lowercase", "debug", true, slog.LevelDebug},
		{"invalid falls back to INFO", "INVALID", true, slog.LevelInfo},
		{"unset falls back to INFO", "", false, slog.LevelInfo},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			unsetEnv(t, "LOG_LEVEL")
			if tt.setEnv {
				t.Setenv("LOG_LEVEL", tt.envValue)
			}

			level := ParseLogLevel()
			if level != tt.expected {
				t.Errorf("ParseLogLevel() = %v, expected %v", level, tt.expected)
			}
		})
	}
}

// The cache kill switch: TOKEN_CACHE_TTL / ALLOWLIST_CACHE_TTL = "0" must DISABLE
// the cache (parse to 0), not fail LoadConfig. Regression guard — before the fix,
// parseDurationEnv rejected 0 and setting the documented kill switch crashed the
// dispatcher at boot instead of disabling the cache.
func TestLoadConfig_CacheTTLKillSwitch(t *testing.T) {
	setRequired := func(t *testing.T) {
		t.Setenv("GCP_PROJECT_ID", "test-project")
		t.Setenv("GCP_PUBSUB_TOPIC", "test-topic")
		t.Setenv("GCP_PUBSUB_DEAUTH_TOPIC", "test-deauth-topic")
		t.Setenv("FIRESTORE_DATABASE", "test-db")
	}

	t.Run("zero disables, does not error", func(t *testing.T) {
		setRequired(t)
		t.Setenv("TOKEN_CACHE_TTL", "0")
		t.Setenv("ALLOWLIST_CACHE_TTL", "0")

		cfg, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig with TTL=0 failed (kill switch must not crash boot): %v", err)
		}
		if cfg.TokenCacheTTL != 0 {
			t.Errorf("TokenCacheTTL = %v, want 0", cfg.TokenCacheTTL)
		}
		if cfg.AllowlistCacheTTL != 0 {
			t.Errorf("AllowlistCacheTTL = %v, want 0", cfg.AllowlistCacheTTL)
		}
	})

	t.Run("unset takes the default", func(t *testing.T) {
		setRequired(t)
		unsetEnv(t, "TOKEN_CACHE_TTL")
		unsetEnv(t, "ALLOWLIST_CACHE_TTL")

		cfg, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}
		if cfg.TokenCacheTTL != DefaultTokenCacheTTL {
			t.Errorf("TokenCacheTTL = %v, want default %v", cfg.TokenCacheTTL, DefaultTokenCacheTTL)
		}
	})

	t.Run("negative is rejected", func(t *testing.T) {
		setRequired(t)
		t.Setenv("TOKEN_CACHE_TTL", "-5m")
		if _, err := LoadConfig(); err == nil {
			t.Error("LoadConfig accepted a negative TTL; want an error")
		}
	})
}
