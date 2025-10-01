package dispatcher

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	// DefaultSecretsPath is the standard secret volume mount path
	DefaultSecretsPath = "/etc/secrets/strava_auth.json"
	// DefaultSecretCacheTTL is the default cache TTL for secret reloading
	DefaultSecretCacheTTL = 5 * time.Minute
)

// Config holds all configuration for the dispatcher.
type Config struct {
	StravaWebhookVerifyToken    string
	StravaWebhookSubscriptionID int
	GCPProjectID                string
	GCPPubSubTopicID            string
	LogLevel                    string
}

// SecretCache provides TTL-based caching with content hash validation for secrets.
type SecretCache struct {
	verifyToken    string
	subscriptionID int
	contentHash    string
	lastCheck      time.Time
	ttl            time.Duration
	secretsPath    string
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
		log.Printf("Failed to hash secrets file: %v", err)
		// Return cached values if available
		if c.verifyToken != "" {
			return c.verifyToken, c.subscriptionID, nil
		}
		return "", 0, fmt.Errorf("failed to read secrets file: %w", err)
	}

	// Content changed or first load
	if currentHash != c.contentHash {
		if err := c.loadSecrets(); err != nil {
			log.Printf("Failed to reload secrets: %v", err)
			// Return cached values if available
			if c.verifyToken != "" {
				return c.verifyToken, c.subscriptionID, nil
			}
			return "", 0, fmt.Errorf("failed to load secrets: %w", err)
		}
		c.contentHash = currentHash
		log.Printf("Secrets reloaded due to content change")
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
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// loadSecrets reads and parses the secrets file.
func (c *SecretCache) loadSecrets() error {
	file, err := os.Open(c.secretsPath)
	if err != nil {
		return err
	}
	defer file.Close()

	var stravaAuth map[string]interface{}
	if err := json.NewDecoder(file).Decode(&stravaAuth); err != nil {
		return err
	}

	// Extract webhook verify token
	if verifyTokenRaw, ok := stravaAuth["webhook_verify_token"]; ok {
		if token, ok := verifyTokenRaw.(string); ok {
			c.verifyToken = token
		}
	}

	// Extract webhook subscription ID
	if subscriptionIDRaw, ok := stravaAuth["webhook_subscription_id"]; ok {
		// JSON numbers are parsed as float64, handle both int and float64
		switch id := subscriptionIDRaw.(type) {
		case float64:
			c.subscriptionID = int(id)
		case int:
			c.subscriptionID = id
		}
	}

	return nil
}

// LoadConfig loads configuration from environment variables and mounted secrets.
func LoadConfig() (*Config, error) {
	// Load webhook secrets from mounted volume if available
	secretsPath := DefaultSecretsPath
	if _, err := os.Stat(secretsPath); err == nil {
		secretsFile, err := os.Open(secretsPath)
		if err != nil {
			log.Printf("Failed to open secrets file: %v", err)
		} else {
			defer secretsFile.Close()

			var stravaAuth map[string]interface{}
			if err := json.NewDecoder(secretsFile).Decode(&stravaAuth); err != nil {
				log.Printf("Failed to decode secrets file: %v", err)
			} else {
				// Set environment variables from secrets (takes precedence)
				if verifyTokenRaw, ok := stravaAuth["webhook_verify_token"]; ok {
					if token, ok := verifyTokenRaw.(string); ok {
						os.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", token)
					}
				}
				if subscriptionIDRaw, ok := stravaAuth["webhook_subscription_id"]; ok {
					// Convert to string for environment variable
					switch id := subscriptionIDRaw.(type) {
					case float64:
						os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", strconv.Itoa(int(id)))
					case int:
						os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", strconv.Itoa(id))
					}
				}
			}
		}
	}

	subIDStr := getEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
	subscriptionID, err := strconv.Atoi(subIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %v", err)
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
