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
	now := time.Now()

	// Fast path: TTL not expired
	if now.Sub(c.lastCheck) < c.ttl {
		defer c.mu.RUnlock()
		return c.verifyToken, c.subscriptionID, nil
	}
	c.mu.RUnlock()

	// Slow path: Check if file content changed
	c.mu.Lock()
	defer c.mu.Unlock()

	currentHash, err := c.hashFile()
	if err != nil {
		Logger.Error("Failed to hash secrets file", "error", err)
		// Return cached values if available
		if c.verifyToken != "" {
			return c.verifyToken, c.subscriptionID, nil
		}
		return "", 0, fmt.Errorf("failed to read secrets file: %w", err)
	}

	// Content changed or first load
	if currentHash != c.contentHash {
		if loadErr := c.loadSecrets(); loadErr != nil {
			Logger.Error("Failed to reload secrets", "error", loadErr)
			// Return cached values if available
			if c.verifyToken != "" {
				return c.verifyToken, c.subscriptionID, nil
			}
			return "", 0, fmt.Errorf("failed to load secrets: %w", err)
		}
		c.contentHash = currentHash
		Logger.Info("Secrets reloaded due to content change")
	}

	c.lastCheck = now
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
			Logger.Error("Failed to close file", "error", closeErr)
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
			Logger.Error("Failed to close secrets file", "error", closeErr)
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
func LoadConfig() (*Config, error) {
	// Load webhook secrets from mounted volume if available
	secretsPath := DefaultSecretsPath
	if _, statErr := os.Stat(secretsPath); statErr == nil {
		secretsFile, openErr := os.Open(secretsPath)
		if openErr != nil {
			Logger.Error("Failed to open secrets file", "error", openErr)
		} else {
			defer func() {
				if closeErr := secretsFile.Close(); closeErr != nil {
					Logger.Error("Failed to close secrets file", "error", closeErr)
				}
			}()

			var secrets StravaSecrets
			if decodeErr := json.NewDecoder(secretsFile).Decode(&secrets); decodeErr != nil {
				Logger.Error("Failed to decode secrets file", "error", decodeErr)
			} else {
				// Set environment variables from secrets (takes precedence)
				if secrets.WebhookVerifyToken != "" {
					if setErr := os.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", secrets.WebhookVerifyToken); setErr != nil {
						Logger.Error("Failed to set STRAVA_WEBHOOK_VERIFY_TOKEN", "error", setErr)
					}
				}
				if secrets.WebhookSubscriptionID != 0 {
					if setErr := os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", strconv.Itoa(secrets.WebhookSubscriptionID)); setErr != nil {
						Logger.Error("Failed to set STRAVA_WEBHOOK_SUBSCRIPTION_ID", "error", setErr)
					}
				}
			}
		}
	}

	subIDStr := getEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
	subscriptionID, err := strconv.Atoi(subIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %w", err)
	}

	return &Config{
		StravaWebhookVerifyToken:    getEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", ""),
		StravaWebhookSubscriptionID: subscriptionID,
		GCPProjectID:                getEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID:            getEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:                    getEnvOrDefault("LOG_LEVEL", "INFO"),
	}, nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
