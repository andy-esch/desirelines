package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultReadTimeout is the default read timeout for HTTP requests.
	DefaultReadTimeout = 30 * time.Second
	// DefaultWriteTimeout is the default write timeout for HTTP requests.
	DefaultWriteTimeout = 30 * time.Second
	// DefaultReadHeaderTimeout is the default read header timeout for HTTP requests.
	DefaultReadHeaderTimeout = 10 * time.Second
	// DefaultShutdownTimeout is the default shutdown timeout for the server.
	DefaultShutdownTimeout = 30 * time.Second
)

// Config holds non-secret configuration for the API Gateway.
// Secrets (Strava credentials, database connection, state secret) are loaded
// separately via secrets.LoadFromMount for Infisical mount support.
type Config struct {
	// GCPProjectID is the GCP project ID (from GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT).
	GCPProjectID string
	// FirestoreDatabase is the named Firestore database (e.g., "desirelines-user-configs").
	FirestoreDatabase string
	// FrontendURL is the URL of the frontend application (for OAuth redirects).
	FrontendURL string
	// AuthCallbackURL is the OAuth callback URL for Strava auth flow.
	AuthCallbackURL string
	// AllowedOrigins is the list of allowed CORS origins.
	AllowedOrigins []string
	// Environment is the deployment environment (e.g., "production"). Empty in local dev.
	Environment string
	// ReadTimeout is the HTTP server read timeout.
	ReadTimeout time.Duration
	// WriteTimeout is the HTTP server write timeout.
	WriteTimeout time.Duration
	// ReadHeaderTimeout is the HTTP server read header timeout.
	ReadHeaderTimeout time.Duration
	// ShutdownTimeout is the maximum time for graceful shutdown.
	ShutdownTimeout time.Duration
}

// LoadConfig loads non-secret configuration from environment variables.
// Secrets are loaded separately via secrets.LoadFromMount for Infisical mount support.
// Returns an error if required configuration is missing.
func LoadConfig() (*Config, error) {
	// Validate required environment variables first (fail fast)
	gcpProjectID := os.Getenv("GCP_PROJECT_ID")
	if gcpProjectID == "" {
		gcpProjectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}
	if gcpProjectID == "" {
		return nil, fmt.Errorf("required environment variable GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT is not set")
	}

	firestoreDatabase := os.Getenv("FIRESTORE_DATABASE")
	if firestoreDatabase == "" {
		return nil, fmt.Errorf("required environment variable FIRESTORE_DATABASE is not set")
	}

	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		return nil, fmt.Errorf("required environment variable FRONTEND_URL is not set")
	}

	authCallbackURL := os.Getenv("AUTH_CALLBACK_URL")
	if authCallbackURL == "" {
		return nil, fmt.Errorf("required environment variable AUTH_CALLBACK_URL is not set")
	}

	readTimeout, err := parseDurationEnvSeconds("SERVER_READ_TIMEOUT", DefaultReadTimeout)
	if err != nil {
		return nil, err
	}

	writeTimeout, err := parseDurationEnvSeconds("SERVER_WRITE_TIMEOUT", DefaultWriteTimeout)
	if err != nil {
		return nil, err
	}

	readHeaderTimeout, err := parseDurationEnvSeconds("SERVER_READ_HEADER_TIMEOUT", DefaultReadHeaderTimeout)
	if err != nil {
		return nil, err
	}

	shutdownTimeout, err := parseDurationEnvSeconds("SERVER_SHUTDOWN_TIMEOUT", DefaultShutdownTimeout)
	if err != nil {
		return nil, err
	}

	return &Config{
		GCPProjectID:      gcpProjectID,
		FirestoreDatabase: firestoreDatabase,
		FrontendURL:       frontendURL,
		AuthCallbackURL:   authCallbackURL,
		AllowedOrigins:    parseCommaSeparated(os.Getenv("ALLOWED_ORIGINS")),
		Environment:       os.Getenv("ENVIRONMENT"),
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		ReadHeaderTimeout: readHeaderTimeout,
		ShutdownTimeout:   shutdownTimeout,
	}, nil
}

// parseDurationEnvSeconds parses an environment variable as an integer number of seconds.
// Returns defaultValue if the environment variable is not set.
// Returns an error if the value is set but invalid.
func parseDurationEnvSeconds(key string, defaultValue time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue, nil
	}
	seconds, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if seconds <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return time.Duration(seconds) * time.Second, nil
}

// parseCommaSeparated splits a comma-separated string, trimming whitespace and filtering empty values.
func parseCommaSeparated(value string) []string {
	if value == "" {
		return nil
	}
	var result []string
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
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
// This is exported for use in cmd entry points (e.g., PORT).
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
