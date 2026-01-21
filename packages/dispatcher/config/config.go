// Package config handles configuration loading for the dispatcher service.
package config

import (
	"os"
)

const (
	// DefaultSecretsPath is the standard secret volume mount path
	// #nosec G101 - This is a file path, not a credential
	DefaultSecretsPath = "/etc/secrets/strava_auth.json"
)

// Config holds non-secret configuration for the dispatcher.
// Secrets (verify token, subscription ID) are handled by SecretCache,
// which provides TTL-based caching and hot-reload support.
type Config struct {
	GCPProjectID     string
	GCPPubSubTopicID string
	LogLevel         string
}

// LoadConfig loads non-secret configuration from environment variables.
// Secrets are loaded separately by SecretCache for caching and hot-reload support.
func LoadConfig() (*Config, error) {
	return &Config{
		GCPProjectID:     GetEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID: GetEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:         GetEnvOrDefault("LOG_LEVEL", "INFO"),
	}, nil
}

// GetEnvOrDefault returns the value of an environment variable or a default value.
// This is exported for use in cmd/local and other entry points.
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
