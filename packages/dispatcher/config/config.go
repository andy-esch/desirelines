// Package config handles configuration loading for the dispatcher service.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

const (
	// DefaultSecretsPath is the standard secret volume mount path
	// #nosec G101 - This is a file path, not a credential
	DefaultSecretsPath = "/etc/secrets/strava_auth.json"

	// Default timeout values
	DefaultReadTimeout       = 30 * time.Second
	DefaultWriteTimeout      = 30 * time.Second
	DefaultReadHeaderTimeout = 10 * time.Second

	// DefaultMaxRequestBodySize is the default maximum request body size (1MB)
	DefaultMaxRequestBodySize = 1 << 20
)

// Config holds non-secret configuration for the dispatcher.
// Secrets (verify token, subscription ID) are handled by SecretCache,
// which provides TTL-based caching and hot-reload support.
type Config struct {
	GCPProjectID      string
	GCPPubSubTopicID  string
	LogLevel          string
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	ReadHeaderTimeout time.Duration
	MaxRequestBodySize int64
}

// LoadConfig loads non-secret configuration from environment variables.
// Secrets are loaded separately by SecretCache for caching and hot-reload support.
func LoadConfig() (*Config, error) {
	readTimeout, err := parseDurationEnv("HTTP_READ_TIMEOUT", DefaultReadTimeout)
	if err != nil {
		return nil, err
	}

	writeTimeout, err := parseDurationEnv("HTTP_WRITE_TIMEOUT", DefaultWriteTimeout)
	if err != nil {
		return nil, err
	}

	readHeaderTimeout, err := parseDurationEnv("HTTP_READ_HEADER_TIMEOUT", DefaultReadHeaderTimeout)
	if err != nil {
		return nil, err
	}

	maxBodySize, err := parseInt64Env("MAX_REQUEST_BODY_SIZE", DefaultMaxRequestBodySize)
	if err != nil {
		return nil, err
	}

	return &Config{
		GCPProjectID:       GetEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID:   GetEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:           GetEnvOrDefault("LOG_LEVEL", "INFO"),
		ReadTimeout:        readTimeout,
		WriteTimeout:       writeTimeout,
		ReadHeaderTimeout:  readHeaderTimeout,
		MaxRequestBodySize: maxBodySize,
	}, nil
}

// parseDurationEnv parses a duration from an environment variable.
// Accepts formats like "30s", "5m", "1h".
func parseDurationEnv(key string, defaultValue time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return d, nil
}

// parseInt64Env parses an int64 from an environment variable.
func parseInt64Env(key string, defaultValue int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue, nil
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return n, nil
}

// GetEnvOrDefault returns the value of an environment variable or a default value.
// This is exported for use in cmd/local and other entry points.
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
