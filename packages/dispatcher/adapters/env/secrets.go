// Package env provides adapters for loading configuration and secrets from the environment and filesystem.
package env

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
)

const (
	// DefaultSecretCacheTTL is the default cache TTL for secret reloading
	DefaultSecretCacheTTL = 5 * time.Minute
)

// stravaSecrets represents the structure of the mounted secret file.
type stravaSecrets struct {
	WebhookVerifyToken    string `json:"webhook_verify_token"`
	WebhookSubscriptionID int    `json:"webhook_subscription_id"`
}

// SecretCache provides TTL-based caching with content hash validation for secrets.
// It implements the SecretProvider interface.
type SecretCache struct {
	lastCheck      time.Time
	contentHash    string
	secretsPath    string
	verifyToken    string
	ttl            time.Duration
	subscriptionID int
	mu             sync.RWMutex
	logger         *slog.Logger
}

// Compile-time check that SecretCache implements SecretProvider.
var _ ports.SecretProvider = (*SecretCache)(nil)

// NewSecretCache creates a new secret cache with the specified TTL.
func NewSecretCache(secretsPath string, ttl time.Duration, logger *slog.Logger) *SecretCache {
	return &SecretCache{
		secretsPath: secretsPath,
		ttl:         ttl,
		logger:      logger,
	}
}

// NewDefaultSecretCache creates a new secret cache with default settings.
func NewDefaultSecretCache(logger *slog.Logger) *SecretCache {
	return NewSecretCache(config.DefaultSecretsPath, DefaultSecretCacheTTL, logger)
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
		c.logger.Error("Failed to hash secrets file", "error", err)
		// Return cached values if available
		if c.verifyToken != "" {
			return c.verifyToken, c.subscriptionID, nil
		}
		return "", 0, fmt.Errorf("failed to read secrets file: %w", err)
	}

	// Content changed or first load
	if currentHash != c.contentHash {
		if loadErr := c.loadSecrets(); loadErr != nil {
			c.logger.Error("Failed to reload secrets", "error", loadErr)
			// Return cached values if available
			if c.verifyToken != "" {
				return c.verifyToken, c.subscriptionID, nil
			}
			return "", 0, fmt.Errorf("failed to load secrets: %w", loadErr)
		}
		c.contentHash = currentHash
		c.logger.Info("Secrets reloaded due to content change")
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
		closeErr := file.Close()
		if closeErr != nil {
			c.logger.Error("Failed to close file", "error", closeErr)
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
		closeErr := file.Close()
		if closeErr != nil {
			c.logger.Error("Failed to close secrets file", "error", closeErr)
		}
	}()

	var secrets stravaSecrets
	if decodeErr := json.NewDecoder(file).Decode(&secrets); decodeErr != nil {
		return decodeErr
	}

	// Direct field access with compile-time type safety
	c.verifyToken = secrets.WebhookVerifyToken
	c.subscriptionID = secrets.WebhookSubscriptionID

	return nil
}
