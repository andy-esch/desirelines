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

	// DefaultActivityRowEncoding is applied when ACTIVITY_ROW_ENCODING is unset.
	// JSON is the safe default: it is what the topic accepts until a protobuf
	// schema is attached to it.
	DefaultActivityRowEncoding = "json"

	// WebhookRouteModeLegacy keeps the existing plain /webhook callback.
	WebhookRouteModeLegacy WebhookRouteMode = "legacy"
	// WebhookRouteModeDual accepts both plain and capability routes temporarily.
	WebhookRouteModeDual WebhookRouteMode = "dual"
	// WebhookRouteModeCapability accepts only the protected callback route.
	WebhookRouteModeCapability WebhookRouteMode = "capability"

	// WebhookCallbackCapabilityLength is 32 random bytes encoded as lowercase
	// hexadecimal. The fixed canonical form makes path parsing bounded and
	// rejects alternate encodings before the constant-time comparison.
	WebhookCallbackCapabilityLength = 64
)

// WebhookRouteMode controls the callback-route cutover. Dual is deliberately a
// migration state; capability is the secure steady state.
type WebhookRouteMode string

// RequiresCallbackCapability reports whether startup must load the callback
// capability secret for this route mode.
func (m WebhookRouteMode) RequiresCallbackCapability() bool {
	return m == WebhookRouteModeDual || m == WebhookRouteModeCapability
}

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
	WebhookRouteMode       WebhookRouteMode
	// ActivityRowPublishEnabled turns on the best-effort publish of each
	// activity as a BigQuery CDC row, alongside the primary webhook publish —
	// the only path by which activity rows reach BigQuery — and the kill switch
	// for it: false stops publishing by config alone, which the activity-row
	// publish and DLQ runbooks name as their mitigation. Safe to stop, because
	// nothing reads BigQuery.
	//
	// Default off so a new environment does not publish before its topic
	// exists.
	// GCPPubSubActivityRowsTopicID is required only when this is true.
	ActivityRowPublishEnabled    bool
	GCPPubSubActivityRowsTopicID string
	// ActivityRowEncoding is the wire format for activity rows: "json" or
	// "proto". It must match what the topic accepts — a schema-bound topic
	// rejects JSON at publish time, and a schemaless one hands protobuf to a
	// subscription that cannot parse it. Defaults to "json".
	ActivityRowEncoding string
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

	webhookRouteMode, err := parseWebhookRouteMode(os.Getenv("WEBHOOK_ROUTE_MODE"))
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

	rowPublish, err := loadActivityRowConfig()
	if err != nil {
		return nil, err
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
		WebhookRouteMode:             webhookRouteMode,
		AllowlistCacheTTL:            allowlistCacheTTL,
		TokenCacheTTL:                tokenCacheTTL,
		ActivityRowPublishEnabled:    rowPublish.enabled,
		GCPPubSubActivityRowsTopicID: rowPublish.topicID,
		ActivityRowEncoding:          rowPublish.encoding,
	}, nil
}

func parseWebhookRouteMode(raw string) (WebhookRouteMode, error) {
	if raw == "" {
		return WebhookRouteModeLegacy, nil
	}

	mode := WebhookRouteMode(raw)
	switch mode {
	case WebhookRouteModeLegacy, WebhookRouteModeDual, WebhookRouteModeCapability:
		return mode, nil
	default:
		return "", fmt.Errorf("WEBHOOK_ROUTE_MODE must be one of legacy, dual, or capability")
	}
}

// ValidateWebhookCallbackCapability validates the only accepted wire format:
// 32 CSPRNG bytes encoded as exactly 64 lowercase hexadecimal characters.
func ValidateWebhookCallbackCapability(value string) error {
	if len(value) != WebhookCallbackCapabilityLength {
		return fmt.Errorf("webhook callback capability must be exactly %d lowercase hexadecimal characters", WebhookCallbackCapabilityLength)
	}
	for _, c := range value {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return fmt.Errorf("webhook callback capability must contain only lowercase hexadecimal characters")
		}
	}
	return nil
}

// activityRowSettings groups the activity-row publish knobs, which are read
// together and constrain each other.
type activityRowSettings struct {
	enabled  bool
	topicID  string
	encoding string
}

// loadActivityRowConfig reads the activity-row publish settings, rejecting the
// combinations that cannot work rather than letting them fail later in prod.
func loadActivityRowConfig() (activityRowSettings, error) {
	enabled, err := parseBoolEnv("ACTIVITY_ROW_PUBLISH_ENABLED", false)
	if err != nil {
		return activityRowSettings{}, err
	}

	// Only required when the flag is on, but then required outright: turning
	// the feature on without a destination is a misconfiguration worth failing
	// at boot rather than discovering in the logs.
	topicID := os.Getenv("GCP_PUBSUB_ACTIVITY_ROWS_TOPIC")
	if enabled && topicID == "" {
		return activityRowSettings{}, fmt.Errorf(
			"environment variable GCP_PUBSUB_ACTIVITY_ROWS_TOPIC is required when ACTIVITY_ROW_PUBLISH_ENABLED is true")
	}

	// Validated, not defaulted: the encoding must match what the topic accepts,
	// and a typo quietly selecting the wrong one produces publish failures that
	// look like an outage.
	encoding := GetEnvOrDefault("ACTIVITY_ROW_ENCODING", DefaultActivityRowEncoding)
	if encoding != "json" && encoding != "proto" {
		return activityRowSettings{}, fmt.Errorf(
			"invalid ACTIVITY_ROW_ENCODING %q: must be \"json\" or \"proto\"", encoding)
	}

	return activityRowSettings{enabled: enabled, topicID: topicID, encoding: encoding}, nil
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
