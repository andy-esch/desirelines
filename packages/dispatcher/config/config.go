package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"
)

const (
	// DefaultReadTimeout is the default read timeout for HTTP requests.
	DefaultReadTimeout = 30 * time.Second
	// DefaultWriteTimeout is the default write timeout for HTTP requests.
	DefaultWriteTimeout = 30 * time.Second
	// DefaultReadHeaderTimeout is the default read header timeout for HTTP requests.
	DefaultReadHeaderTimeout = 10 * time.Second

	// DefaultMaxRequestBodySize is the default maximum request body size (1MB)
	DefaultMaxRequestBodySize int64 = 1 << 20
)

// Config holds non-secret configuration for the dispatcher.
// Secrets (verify token, subscription ID) are handled by SecretCache,
// which provides TTL-based caching and hot-reload support.
type Config struct {
	GCPProjectID       string
	GCPPubSubTopicID   string
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	ReadHeaderTimeout  time.Duration
	MaxRequestBodySize int64
}

// LoadConfig loads non-secret configuration from environment variables.
// Secrets are loaded separately by SecretCache for caching and hot-reload support.
// Returns an error if required configuration is missing.
func LoadConfig() (*Config, error) {
	// Validate required environment variables first (fail fast)
	gcpProjectID := os.Getenv("GCP_PROJECT_ID")
	if gcpProjectID == "" {
		return nil, fmt.Errorf("required environment variable GCP_PROJECT_ID is not set")
	}

	gcpPubSubTopicID := os.Getenv("GCP_PUBSUB_TOPIC")
	if gcpPubSubTopicID == "" {
		return nil, fmt.Errorf("required environment variable GCP_PUBSUB_TOPIC is not set")
	}

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
		GCPProjectID:       gcpProjectID,
		GCPPubSubTopicID:   gcpPubSubTopicID,
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

// ParseLogLevel reads LOG_LEVEL from the environment and returns the corresponding slog.Level.
// Accepts "DEBUG", "INFO", "WARN", "ERROR" (case-insensitive). Defaults to INFO.
func ParseLogLevel() slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(GetEnvOrDefault("LOG_LEVEL", "INFO"))); err != nil {
		return slog.LevelInfo
	}
	return level
}

// GetEnvOrDefault returns the value of an environment variable or a default value.
// This is exported for use in cmd/local and other entry points.
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
