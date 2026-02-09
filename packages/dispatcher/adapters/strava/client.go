// Package strava provides a client for the Strava REST API.
package strava

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
)

// Sentinel errors for Strava API failures.
var (
	ErrActivityNotFound = errors.New("strava: activity not found")
	ErrStravaAuth       = errors.New("strava: authentication failed after retry")
	ErrStravaAPI        = errors.New("strava: API error")
)

const (
	//nolint:gosec // URL, not credential
	defaultTokenURL = "https://www.strava.com/oauth/token"
	defaultAPIBase  = "https://www.strava.com/api/v3"

	// Retry settings for token refresh.
	tokenRetryAttempts = 2
	tokenRetryBackoff  = 500 * time.Millisecond

	// Retry settings for activity fetch.
	activityRetryAttempts = 3
	activityRetryBackoff  = 1 * time.Second

	// Response size limits to prevent memory exhaustion.
	// Activity JSON is typically 5-50KB; 5MB is a generous safety cap.
	// Token responses are a few hundred bytes; 64KB is more than enough.
	maxActivityResponseBytes = 5 << 20  // 5 MB
	maxTokenResponseBytes    = 64 << 10 // 64 KB
)

// tokenResponse represents the JSON response from Strava's OAuth token endpoint.
type tokenResponse struct {
	AccessToken string `json:"access_token"`
}

// Client implements ports.StravaClient by calling the Strava REST API.
type Client struct {
	httpClient   *http.Client
	clientID     string
	clientSecret string
	refreshToken string
	accessToken  string
	tokenURL     string
	apiBase      string
	mu           sync.RWMutex
	logger       *slog.Logger
}

// Compile-time check that Client implements StravaClient.
var _ ports.StravaClient = (*Client)(nil)

// NewClient creates a new Strava API client.
// Credentials are loaded from secret files or environment variables.
func NewClient(logger *slog.Logger) (*Client, error) {
	clientID := loadSecret(config.SecretPathStravaClientID, "STRAVA_CLIENT_ID")
	if clientID == "" {
		return nil, errors.New("strava client_id not found in file or environment")
	}

	clientSecret := loadSecret(config.SecretPathStravaClientSecret, "STRAVA_CLIENT_SECRET")
	if clientSecret == "" {
		return nil, errors.New("strava client_secret not found in file or environment")
	}

	refreshToken := loadSecret(config.SecretPathStravaRefreshToken, "STRAVA_REFRESH_TOKEN")
	if refreshToken == "" {
		return nil, errors.New("strava refresh_token not found in file or environment")
	}

	logger.Info("Strava client initialized")

	return &Client{
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		clientID:     clientID,
		clientSecret: clientSecret,
		refreshToken: refreshToken,
		tokenURL:     defaultTokenURL,
		apiBase:      defaultAPIBase,
		logger:       logger,
	}, nil
}

// loadSecret reads a secret from a file path, falling back to an environment variable.
func loadSecret(filePath, envVar string) string {
	data, err := os.ReadFile(filePath) //nolint:gosec // Path from trusted config
	if err == nil {
		return strings.TrimSpace(string(data))
	}
	return config.GetEnvOrDefault(envVar, "")
}

// FetchActivity retrieves the raw JSON for a Strava activity.
// Retries on transient errors and refreshes the token on 401.
func (c *Client) FetchActivity(ctx context.Context, activityID int64) ([]byte, error) {
	// Ensure we have a valid access token
	if err := c.ensureToken(ctx); err != nil {
		return nil, err
	}

	var lastErr error
	for attempt := range activityRetryAttempts {
		body, err := c.doFetchActivity(ctx, activityID)
		if err == nil {
			return body, nil
		}

		// 404 is not retryable
		if errors.Is(err, ErrActivityNotFound) {
			return nil, err
		}

		// 401: refresh token and let the loop retry with the new token
		if isAuthError(err) {
			c.logger.Warn("Strava 401, refreshing token", "activity_id", activityID)
			if refreshErr := c.refreshAccessToken(ctx); refreshErr != nil {
				return nil, fmt.Errorf("%w: token refresh failed: %w", ErrStravaAuth, refreshErr)
			}
			lastErr = err
			continue
		}

		lastErr = err
		if attempt < activityRetryAttempts-1 {
			backoff := activityRetryBackoff * time.Duration(math.Pow(2, float64(attempt)))
			c.logger.Warn("Strava fetch retry",
				"activity_id", activityID,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", err,
			)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}
	}

	return nil, fmt.Errorf("%w: %w", ErrStravaAPI, lastErr)
}

// doFetchActivity performs a single GET request to the Strava activities endpoint.
func (c *Client) doFetchActivity(ctx context.Context, activityID int64) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/activities/%d", c.apiBase, activityID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.mu.RLock()
	token := c.accessToken
	c.mu.RUnlock()

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body", "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxActivityResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusNotFound:
		return nil, ErrActivityNotFound
	case http.StatusUnauthorized:
		return nil, &authError{statusCode: resp.StatusCode}
	default:
		return nil, fmt.Errorf("strava API returned %d: %s", resp.StatusCode, string(body))
	}
}

// ensureToken refreshes the access token if it hasn't been set yet.
func (c *Client) ensureToken(ctx context.Context) error {
	c.mu.RLock()
	hasToken := c.accessToken != ""
	c.mu.RUnlock()

	if hasToken {
		return nil
	}
	return c.refreshAccessToken(ctx)
}

// refreshAccessToken gets a new access token from Strava's OAuth endpoint.
func (c *Client) refreshAccessToken(ctx context.Context) error {
	var lastErr error
	for attempt := range tokenRetryAttempts {
		err := c.doRefreshToken(ctx)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt < tokenRetryAttempts-1 {
			backoff := tokenRetryBackoff * time.Duration(math.Pow(2, float64(attempt)))
			c.logger.Warn("Token refresh retry",
				"attempt", attempt+1,
				"backoff", backoff,
				"error", err,
			)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}
	}
	return fmt.Errorf("token refresh failed after %d attempts: %w", tokenRetryAttempts, lastErr)
}

// doRefreshToken performs a single token refresh request.
func (c *Client) doRefreshToken(ctx context.Context) error {
	form := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
		"refresh_token": {c.refreshToken},
		"grant_type":    {"refresh_token"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("token request failed: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body", "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return fmt.Errorf("failed to read token response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("token refresh returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenResponse
	if unmarshalErr := json.Unmarshal(body, &tokenResp); unmarshalErr != nil {
		return fmt.Errorf("decode token response: %w", unmarshalErr)
	}

	if tokenResp.AccessToken == "" {
		return errors.New("token response missing access_token")
	}

	c.mu.Lock()
	c.accessToken = tokenResp.AccessToken
	c.mu.Unlock()

	c.logger.Info("Strava access token refreshed")
	return nil
}

// authError is an internal error type for 401 responses.
type authError struct {
	statusCode int
}

func (e *authError) Error() string {
	return fmt.Sprintf("strava auth error: HTTP %d", e.statusCode)
}

// isAuthError checks if an error is a 401 auth error.
func isAuthError(err error) bool {
	var ae *authError
	return errors.As(err, &ae)
}
