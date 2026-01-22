// Package env provides adapters for loading configuration and secrets from the environment and filesystem.
package env

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
)

const (
	// DefaultSecretCacheTTL is the default cache TTL for secret reloading
	DefaultSecretCacheTTL = 5 * time.Minute

	// maxSecureFileMode is the maximum allowed file mode for secrets files.
	// Only owner read/write is permitted (0600).
	maxSecureFileMode fs.FileMode = 0o600
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
		if os.IsNotExist(err) {
			// File doesn't exist
			if c.verifyToken != "" {
				// We have cached values from a previous successful load
				// File may be temporarily unavailable - return cached values
				c.logger.Warn("Secrets file missing, using cached values", "path", c.secretsPath)
				return c.verifyToken, c.subscriptionID, nil
			}
			// First load with no file - try environment variables
			if loadErr := c.loadSecretsFromEnv(); loadErr != nil {
				return "", 0, loadErr
			}
			c.lastCheck = time.Now()
			return c.verifyToken, c.subscriptionID, nil
		}
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
// Returns error if file doesn't exist (caller decides whether to use cache or env vars).
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
// Verifies file permissions before reading.
// Called only when file is known to exist.
func (c *SecretCache) loadSecrets() error {
	// Verify file permissions
	info, err := os.Stat(c.secretsPath)
	if err != nil {
		return fmt.Errorf("failed to stat secrets file: %w", err)
	}

	// Check file permissions - reject if group or world readable
	mode := info.Mode().Perm()
	if mode&0o077 != 0 {
		return fmt.Errorf("secrets file %s has insecure permissions %04o (expected %04o or stricter)",
			c.secretsPath, mode, maxSecureFileMode)
	}

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

// loadSecretsFromEnv loads secrets from environment variables.
// Used as fallback when secrets file doesn't exist.
func (c *SecretCache) loadSecretsFromEnv() error {
	c.verifyToken = config.GetEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", "")

	subIDStr := config.GetEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
	parsed, parseErr := strconv.Atoi(subIDStr)
	if parseErr != nil {
		return fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %w", parseErr)
	}

	// Validate subscription ID is within int32 bounds (proto uses int32)
	if parsed < 0 || parsed > math.MaxInt32 {
		return fmt.Errorf("STRAVA_WEBHOOK_SUBSCRIPTION_ID must be between 0 and %d", math.MaxInt32)
	}

	c.subscriptionID = parsed
	return nil
}
