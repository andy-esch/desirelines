package env

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
)

// DefaultSecretCacheTTL is the default cache TTL for secret reloading.
const DefaultSecretCacheTTL = 5 * time.Minute

// SecretCache provides TTL-based caching with content hash validation for secrets.
// It implements the SecretProvider interface.
type SecretCache struct {
	lastCheck          time.Time
	contentHash        string
	verifyTokenPath    string
	subscriptionIDPath string
	verifyToken        string
	ttl                time.Duration
	subscriptionID     int32
	mu                 sync.RWMutex
	logger             *slog.Logger
}

// Compile-time check that SecretCache implements SecretProvider.
var _ ports.SecretProvider = (*SecretCache)(nil)

// NewSecretCache creates a new secret cache with the specified TTL.
func NewSecretCache(verifyTokenPath, subscriptionIDPath string, ttl time.Duration, logger *slog.Logger) *SecretCache {
	return &SecretCache{
		verifyTokenPath:    verifyTokenPath,
		subscriptionIDPath: subscriptionIDPath,
		ttl:                ttl,
		logger:             logger,
	}
}

// NewDefaultSecretCache creates a new secret cache with default settings.
func NewDefaultSecretCache(logger *slog.Logger) *SecretCache {
	return NewSecretCache(config.SecretPathVerifyToken, config.SecretPathSubscriptionID, DefaultSecretCacheTTL, logger)
}

// GetSecrets returns cached secrets or reloads them if TTL expired or content changed.
func (c *SecretCache) GetSecrets() (string, int32, error) {
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

	currentHash, err := c.hashFiles()
	if err != nil {
		c.logger.Error("Failed to hash secrets files", "error", err)
		// Return cached values if available
		if c.verifyToken != "" {
			return c.verifyToken, c.subscriptionID, nil
		}
		// First load with no file - try environment variables
		if loadErr := c.loadSecretsFromEnv(); loadErr != nil {
			return "", 0, loadErr
		}
		c.lastCheck = time.Now()
		return c.verifyToken, c.subscriptionID, nil
	}

	// Content changed or first load
	if currentHash != c.contentHash {
		token, subID, loadErr := c.loadSecrets()
		if loadErr != nil {
			c.logger.Warn("Failed to reload secrets, using cached values", "error", loadErr)
			// Return cached values if available
			if c.verifyToken != "" {
				return c.verifyToken, c.subscriptionID, nil
			}
			return "", 0, fmt.Errorf("failed to load secrets: %w", loadErr)
		}
		c.verifyToken = token
		c.subscriptionID = subID
		c.contentHash = currentHash
		c.logger.Info("Secrets reloaded due to content change")
	}

	c.lastCheck = time.Now()
	return c.verifyToken, c.subscriptionID, nil
}

// hashFiles computes SHA256 hash of both secret files.
func (c *SecretCache) hashFiles() (string, error) {
	h := sha256.New()

	// Hash verify token file
	if err := c.addFileToHash(h, c.verifyTokenPath); err != nil {
		return "", err
	}

	// Hash subscription ID file
	if err := c.addFileToHash(h, c.subscriptionIDPath); err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func (c *SecretCache) addFileToHash(h io.Writer, path string) error {
	file, err := os.Open(path) //nolint:gosec // Path comes from trusted config
	if err != nil {
		if os.IsNotExist(err) {
			// If file doesn't exist, write a placeholder to the hash
			// so that if it appears later, the hash changes.
			// Hash.Write never returns an error for in-memory hashes.
			_, _ = h.Write([]byte("not-found")) //nolint:errcheck
			return nil
		}
		return err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			c.logger.Warn("Failed to close secrets file", "path", path, "error", closeErr)
		}
	}()
	_, err = io.Copy(h, file)
	return err
}

// loadSecrets reads and parses the secrets files.
func (c *SecretCache) loadSecrets() (string, int32, error) {
	var verifyToken string
	var subscriptionID int32

	// 1. Load Verify Token
	tokenBytes, err := os.ReadFile(c.verifyTokenPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return "", 0, fmt.Errorf("failed to read verify token file: %w", err)
		}
		// Fallback to environment
		verifyToken = config.GetEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
		if verifyToken == "" {
			return "", 0, fmt.Errorf("verify token not found in file or environment")
		}
	} else {
		verifyToken = strings.TrimSpace(string(tokenBytes))
	}

	// 2. Load Subscription ID
	subIDBytes, err := os.ReadFile(c.subscriptionIDPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return "", 0, fmt.Errorf("failed to read subscription id file: %w", err)
		}
		// Fallback to environment
		subIDStr := config.GetEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")
		if subIDStr == "" {
			return "", 0, fmt.Errorf("subscription id not found in file or environment")
		}
		parsed, parseErr := strconv.Atoi(subIDStr)
		if parseErr != nil {
			return "", 0, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID from env: %w", parseErr)
		}
		if parsed < 0 || parsed > math.MaxInt32 {
			return "", 0, fmt.Errorf("STRAVA_WEBHOOK_SUBSCRIPTION_ID must be between 0 and %d", math.MaxInt32)
		}
		subscriptionID = int32(parsed) //nolint:gosec // Validated above
	} else {
		parsed, parseErr := strconv.Atoi(strings.TrimSpace(string(subIDBytes)))
		if parseErr != nil {
			return "", 0, fmt.Errorf("invalid subscription id in file: %w", parseErr)
		}
		if parsed < 0 || parsed > math.MaxInt32 {
			return "", 0, fmt.Errorf("subscription id must be between 0 and %d", math.MaxInt32)
		}
		subscriptionID = int32(parsed) //nolint:gosec // Validated above
	}

	return verifyToken, subscriptionID, nil
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

	c.subscriptionID = int32(parsed) //nolint:gosec // Validated above
	return nil
}
