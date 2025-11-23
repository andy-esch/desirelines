package dispatcher

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	// DefaultSecretsPath is the standard secret volume mount path
	// #nosec G101 - This is a file path, not a credential
	DefaultSecretsPath = "/etc/secrets/strava_auth.json"
	// DefaultSecretCacheTTL is the default cache TTL for secret reloading
	DefaultSecretCacheTTL = 5 * time.Minute
)

// Config holds all configuration for the dispatcher.
type Config struct {
	StravaWebhookVerifyToken    string
	GCPProjectID                string
	GCPPubSubTopicID            string
	LogLevel                    string
	StravaWebhookSubscriptionID int
}

// StravaSecrets represents the structure of the mounted secret file.
type StravaSecrets struct {
	WebhookVerifyToken    string `json:"webhook_verify_token"`
	WebhookSubscriptionID int    `json:"webhook_subscription_id"`
}

// SecretCache provides TTL-based caching with content hash validation for secrets.
type SecretCache struct {
	lastCheck      time.Time
	contentHash    string
	secretsPath    string
	verifyToken    string
	ttl            time.Duration
	subscriptionID int
	mu             sync.RWMutex
}

// NewSecretCache creates a new secret cache with the specified TTL.
func NewSecretCache(secretsPath string, ttl time.Duration) *SecretCache {
	return &SecretCache{
		secretsPath: secretsPath,
		ttl:         ttl,
	}
}

// NewDefaultSecretCache creates a new secret cache with default settings.
func NewDefaultSecretCache() *SecretCache {
	return NewSecretCache(DefaultSecretsPath, DefaultSecretCacheTTL)
}

// GetSecrets returns cached secrets or reloads them if TTL expired or content changed.
func (c *SecretCache) GetSecrets() (string, int, error) {
	c.mu.RLock()

	// Fast path: TTL not expired
	if time.Since(c.lastCheck) < c.ttl {
		defer c.mu.RUnlock()
		return c.verifyToken, c.subscriptionID, nil
	}
	c.mu.RUnlock()

	// Slow path: Check if file content changed
	c.mu.Lock()
	defer c.mu.Unlock()

	// Re-check TTL after acquiring write lock (another goroutine may have just updated)
	if time.Since(c.lastCheck) < c.ttl {
		return c.verifyToken, c.subscriptionID, nil
	}

	currentHash, err := c.hashFile()
	if err != nil {
		DefaultLogger.Error("Failed to hash secrets file", "error", err)
		// Return cached values if available
		if c.verifyToken != "" {
			return c.verifyToken, c.subscriptionID, nil
		}
		return "", 0, fmt.Errorf("failed to read secrets file: %w", err)
	}

	// Content changed or first load
	if currentHash != c.contentHash {
		if loadErr := c.loadSecrets(); loadErr != nil {
			DefaultLogger.Error("Failed to reload secrets", "error", loadErr)
			// Return cached values if available
			if c.verifyToken != "" {
				return c.verifyToken, c.subscriptionID, nil
			}
			return "", 0, fmt.Errorf("failed to load secrets: %w", loadErr)
		}
		c.contentHash = currentHash
		DefaultLogger.Info("Secrets reloaded due to content change")
	}

	c.lastCheck = time.Now()
	return c.verifyToken, c.subscriptionID, nil
}

// hashFile computes SHA256 hash of the secrets file content.
func (c *SecretCache) hashFile() (string, error) {
	file, err := os.Open(c.secretsPath)
	if err != nil {
		return "", err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			DefaultLogger.Error("Failed to close file", "error", closeErr)
		}
	}()

	hash := sha256.New()
	if _, copyErr := io.Copy(hash, file); copyErr != nil {
		return "", copyErr
	}

	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// loadSecrets reads and parses the secrets file.
func (c *SecretCache) loadSecrets() error {
	file, err := os.Open(c.secretsPath)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			DefaultLogger.Error("Failed to close secrets file", "error", closeErr)
		}
	}()

	var secrets StravaSecrets
	if decodeErr := json.NewDecoder(file).Decode(&secrets); decodeErr != nil {
		return decodeErr
	}

	// Direct field access with compile-time type safety
	c.verifyToken = secrets.WebhookVerifyToken
	c.subscriptionID = secrets.WebhookSubscriptionID

	return nil
}

// LoadConfig loads configuration from environment variables and mounted secrets.
// Secrets from the mounted volume take precedence over environment variables.
func LoadConfig() (*Config, error) {
	// Load webhook secrets from mounted volume if available
	secrets := loadSecretsFile(DefaultSecretsPath)

	// Build config with precedence: secrets file > env vars > defaults
	verifyToken := secrets.WebhookVerifyToken
	if verifyToken == "" {
		verifyToken = GetEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	}

	subscriptionID := secrets.WebhookSubscriptionID
	if subscriptionID == 0 {
		subIDStr := GetEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
		parsed, err := strconv.Atoi(subIDStr)
		if err != nil {
			return nil, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %w", err)
		}
		subscriptionID = parsed
	}

	return &Config{
		StravaWebhookVerifyToken:    verifyToken,
		StravaWebhookSubscriptionID: subscriptionID,
		GCPProjectID:                GetEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID:            GetEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:                    GetEnvOrDefault("LOG_LEVEL", "INFO"),
	}, nil
}

// loadSecretsFile reads secrets from the mounted volume.
// Returns an empty StravaSecrets struct if the file doesn't exist or can't be read.
func loadSecretsFile(path string) StravaSecrets {
	var secrets StravaSecrets

	if _, statErr := os.Stat(path); statErr != nil {
		// File doesn't exist - not an error, just use env vars
		return secrets
	}

	// #nosec G304 - path is controlled (DefaultSecretsPath constant), not user input
	file, openErr := os.Open(path)
	if openErr != nil {
		DefaultLogger.Error("Failed to open secrets file", "error", openErr)
		return secrets
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			DefaultLogger.Error("Failed to close secrets file", "error", closeErr)
		}
	}()

	if decodeErr := json.NewDecoder(file).Decode(&secrets); decodeErr != nil {
		DefaultLogger.Error("Failed to decode secrets file", "error", decodeErr)
		return StravaSecrets{} // Return empty on decode error
	}

	return secrets
}

// GetEnvOrDefault returns the value of an environment variable or a default value.
// This is exported for use in cmd/local and other entry points.
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
