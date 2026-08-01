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

	// DefaultAllowlistCacheTTL is applied when ALLOWLIST_CACHE_TTL is unset. Only
	// positive decisions are cached and deauth invalidates them explicitly, so the
	// TTL is a backstop bounding the false-orphan window if an invalidation is ever
	// missed — not the primary consistency mechanism. Set the env var to "0" to
	// disable the cache.
	DefaultAllowlistCacheTTL = 5 * time.Minute

	// DefaultTokenCacheTTL is applied when TOKEN_CACHE_TTL is unset. Bounds staleness
	// against out-of-process token writes the in-process cache can't see (apigateway
	// re-auth); local mutations invalidate directly. Set the env var to "0" to disable.
	DefaultTokenCacheTTL = 5 * time.Minute
)

// Config holds non-secret configuration for the dispatcher.
// Secrets (verify token, subscription ID) are handled by SecretCache,
// which provides TTL-based caching and hot-reload support.
type Config struct {
	GCPProjectID           string
	GCPPubSubTopicID       string
	GCPPubSubDeauthTopicID string
	FirestoreDatabase      string
	ReadTimeout            time.Duration
	WriteTimeout           time.Duration
	ReadHeaderTimeout      time.Duration
	MaxRequestBodySize     int64
	// ActivityRowPublishEnabled turns on the best-effort second publish of each
	// activity as a BigQuery CDC row, alongside the primary webhook publish.
	// Default off: the feature is additive and its destination table has no
	// readers, so it ships dark and is switched on per environment.
	// GCPPubSubActivityRowsTopicID is required only when this is true.
	ActivityRowPublishEnabled    bool
	GCPPubSubActivityRowsTopicID string
	// AllowlistCacheTTL / TokenCacheTTL: 0 disables the respective cache, so a
	// suspected staleness bug can be ruled out in prod by setting the env var to
	// "0" and redeploying — no code change, no rollback.
	AllowlistCacheTTL time.Duration
	TokenCacheTTL     time.Duration
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

	gcpPubSubDeauthTopicID := os.Getenv("GCP_PUBSUB_DEAUTH_TOPIC")
	if gcpPubSubDeauthTopicID == "" {
		return nil, fmt.Errorf("required environment variable GCP_PUBSUB_DEAUTH_TOPIC is not set")
	}

	firestoreDatabase := os.Getenv("FIRESTORE_DATABASE")
	if firestoreDatabase == "" {
		return nil, fmt.Errorf("required environment variable FIRESTORE_DATABASE is not set")
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

	// AllowZero, not parseDurationEnv: "0" is the documented kill switch (disable
	// the cache), so it must parse to 0, not fail-closed the way a bad HTTP
	// timeout should. Unset still takes the 5m default; negative is still rejected.
	allowlistCacheTTL, err := parseDurationEnvAllowZero("ALLOWLIST_CACHE_TTL", DefaultAllowlistCacheTTL)
	if err != nil {
		return nil, err
	}

	tokenCacheTTL, err := parseDurationEnvAllowZero("TOKEN_CACHE_TTL", DefaultTokenCacheTTL)
	if err != nil {
		return nil, err
	}

	activityRowPublishEnabled, err := parseBoolEnv("ACTIVITY_ROW_PUBLISH_ENABLED", false)
	if err != nil {
		return nil, err
	}

	// Only required when the flag is on, but then it is required outright:
	// turning the feature on without a destination is a misconfiguration
	// worth failing at boot rather than discovering in the logs.
	gcpPubSubActivityRowsTopicID := os.Getenv("GCP_PUBSUB_ACTIVITY_ROWS_TOPIC")
	if activityRowPublishEnabled && gcpPubSubActivityRowsTopicID == "" {
		return nil, fmt.Errorf("environment variable GCP_PUBSUB_ACTIVITY_ROWS_TOPIC is required when ACTIVITY_ROW_PUBLISH_ENABLED is true")
	}

	return &Config{
		GCPProjectID:                 gcpProjectID,
		GCPPubSubTopicID:             gcpPubSubTopicID,
		GCPPubSubDeauthTopicID:       gcpPubSubDeauthTopicID,
		FirestoreDatabase:            firestoreDatabase,
		ReadTimeout:                  readTimeout,
		WriteTimeout:                 writeTimeout,
		ReadHeaderTimeout:            readHeaderTimeout,
		MaxRequestBodySize:           maxBodySize,
		AllowlistCacheTTL:            allowlistCacheTTL,
		TokenCacheTTL:                tokenCacheTTL,
		ActivityRowPublishEnabled:    activityRowPublishEnabled,
		GCPPubSubActivityRowsTopicID: gcpPubSubActivityRowsTopicID,
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

// parseDurationEnvAllowZero is parseDurationEnv for values where zero is a valid
// "disable" signal rather than a misconfiguration: unset takes the default,
// "0"/"0s" parses to 0 (caller treats it as disabled), and only a negative value
// is an error. Used by the cache-TTL kill switches.
func parseDurationEnvAllowZero(key string, defaultValue time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if d < 0 {
		return 0, fmt.Errorf("%s must not be negative", key)
	}
	return d, nil
}

// parseBoolEnv parses a bool from an environment variable, accepting the forms
// strconv.ParseBool does ("true"/"false", "1"/"0", "t"/"f"). Unset takes the
// default; an unparseable value is an error rather than a silent false, so a
// typo in a feature flag surfaces at boot instead of looking like "off".
func parseBoolEnv(key string, defaultValue bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue, nil
	}
	b, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("invalid %s: %w", key, err)
	}
	return b, nil
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
