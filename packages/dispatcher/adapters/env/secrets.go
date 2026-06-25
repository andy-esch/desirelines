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
			// Advance lastCheck so a *persistent* hash fault doesn't re-hash and
			// re-log under the write lock on every request. GetSecrets is on the
			// per-request webhook hot path; without this the fault path runs on
			// each call. The cached secrets are still valid — gate the retry for
			// one TTL and recover at the next TTL boundary once the fault clears.
			c.lastCheck = time.Now()
			return c.verifyToken, c.subscriptionID, nil
		}
		// Secrets files unreadable (permission/IO error) and no value cached yet
		// — fall back to environment variables. A *missing* file does not reach
		// here: addFileToHash treats absence as a non-error placeholder, so it
		// flows through the normal hash-compare → loadSecrets → env-fallback path.
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
				// Advance lastCheck so a *persistent* reload fault doesn't
				// re-hash + reload + re-log on every request (same hot-path
				// concern as the hash-error branch above). contentHash is left
				// stale on purpose so the reload is retried — and succeeds — at
				// the next TTL boundary once the fault clears.
				c.lastCheck = time.Now()
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
			// Null-byte prefix ensures no collision with valid file content.
			// Hash.Write never returns an error for in-memory hashes.
			_, _ = h.Write([]byte("\x00MISSING\x00")) //nolint:errcheck // Hash.Write never returns error
			return nil
		}
		return fmt.Errorf("open secrets file %q: %w", path, err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			c.logger.Warn("Failed to close secrets file", "path", path, "error", closeErr)
		}
	}()
	if _, copyErr := io.Copy(h, file); copyErr != nil {
		return fmt.Errorf("hash secrets file %q: %w", path, copyErr)
	}
	return nil
}

// parseSubscriptionID parses a Strava webhook subscription ID and narrows it
// to the int32 the proto field uses, rejecting out-of-range values. It does not
// trim its input; callers trim where the source warrants it.
func parseSubscriptionID(s string) (int32, error) {
	// ParseInt with an explicit 64-bit size keeps the range check deterministic
	// across architectures; strconv.Atoi parses into a platform-width int, so on
	// a 32-bit build an ID > MaxInt32 would fail inside Atoi instead of hitting
	// the explicit out-of-range message below.
	parsed, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse subscription id: %w", err)
	}
	if parsed < 0 || parsed > math.MaxInt32 {
		return 0, fmt.Errorf("subscription id must be between 0 and %d", math.MaxInt32)
	}
	return int32(parsed), nil
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
		// Reject whitespace-only / empty files: caching "" would let
		// subtle.ConstantTimeCompare(\"\", \"\") return 1 and any caller
		// could echo back hub.challenge. See packages/dispatcher/adapters/http/handler.go
		// handleVerification.
		verifyToken = strings.TrimSpace(string(tokenBytes))
		if verifyToken == "" {
			return "", 0, fmt.Errorf("verify token file %q is empty after trimming whitespace", c.verifyTokenPath)
		}
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
		subscriptionID, err = parseSubscriptionID(subIDStr)
		if err != nil {
			return "", 0, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID from env: %w", err)
		}
	} else {
		subscriptionID, err = parseSubscriptionID(strings.TrimSpace(string(subIDBytes)))
		if err != nil {
			return "", 0, fmt.Errorf("invalid subscription id in file: %w", err)
		}
	}

	return verifyToken, subscriptionID, nil
}

// loadSecretsFromEnv loads secrets from environment variables.
// Used as fallback when secrets file doesn't exist. Defers any
// mutation of c until every env var has parsed and validated, so a
// partial failure cannot leave c with a fresh verifyToken paired
// against a stale subscriptionID — the cached-fallback branch in
// GetSecrets would then return the mismatched pair without surfacing
// the error.
func (c *SecretCache) loadSecretsFromEnv() error {
	verifyToken := config.GetEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	if verifyToken == "" {
		// See loadSecrets: empty verify token must never reach the
		// constant-time compare in handleVerification.
		return fmt.Errorf("verify token not found in environment (STRAVA_WEBHOOK_VERIFY_TOKEN)")
	}

	subIDStr := config.GetEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "")
	if subIDStr == "" {
		return fmt.Errorf("subscription id not found in environment")
	}
	subscriptionID, err := parseSubscriptionID(subIDStr)
	if err != nil {
		return fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %w", err)
	}

	c.verifyToken = verifyToken
	c.subscriptionID = subscriptionID
	return nil
}
