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
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Sentinel errors for Strava API failures.
var (
	// ErrActivityNotFound is an alias for ports.ErrActivityNotFound for
	// backward compatibility within this package's tests.
	ErrActivityNotFound = ports.ErrActivityNotFound
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

	// httpClientTimeout is the timeout for individual HTTP requests to the Strava API.
	httpClientTimeout = 10 * time.Second

	// Response size limits to prevent memory exhaustion.
	// Activity JSON is typically 5-50KB; 5MB is a generous safety cap.
	// Token responses are a few hundred bytes; 64KB is more than enough.
	maxActivityResponseBytes = 5 << 20  // 5 MB
	maxTokenResponseBytes    = 64 << 10 // 64 KB
)

// tokenResponse represents the JSON response from Strava's OAuth token endpoint.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

// Client implements ports.StravaClient by calling the Strava REST API.
// Stateless: each FetchActivity call reads tokens from the TokenStore
// and writes back refreshed tokens after a token refresh.
type Client struct {
	httpClient   *http.Client
	clientID     string
	clientSecret string
	tokenStore   ports.TokenStore
	tokenURL     string
	apiBase      string
	logger       *slog.Logger
	histogram    metric.Float64Histogram
}

// Compile-time check that Client implements StravaClient.
var _ ports.StravaClient = (*Client)(nil)

// NewClient creates a new Strava API client.
// OAuth client credentials must be injected by the caller (composition root).
// Per-user tokens are read from the TokenStore on each request.
func NewClient(clientID, clientSecret string, tokenStore ports.TokenStore, logger *slog.Logger, histogram metric.Float64Histogram) *Client {
	return &Client{
		httpClient:   &http.Client{Timeout: httpClientTimeout},
		clientID:     clientID,
		clientSecret: clientSecret,
		tokenStore:   tokenStore,
		tokenURL:     defaultTokenURL,
		apiBase:      defaultAPIBase,
		logger:       logger,
		histogram:    histogram,
	}
}

// FetchActivity retrieves the raw JSON for a Strava activity.
// Reads the owner's tokens from the TokenStore, retries on transient errors,
// and refreshes + persists tokens on 401.
func (c *Client) FetchActivity(ctx context.Context, ownerID, activityID int64) ([]byte, error) {
	tokens, err := c.tokenStore.GetTokens(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("get tokens for athlete %d: %w", ownerID, err)
	}

	// If no access token, refresh first
	if tokens.AccessToken == "" {
		refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens)
		if refreshErr != nil {
			return nil, fmt.Errorf("%w: initial token refresh failed: %w", ErrStravaAuth, refreshErr)
		}
		tokens = refreshedTokens
	}

	var lastErr error
	authRefreshed := false
	for attempt := range activityRetryAttempts {
		done := otel.RecordDuration(ctx, c.histogram, attribute.String("operation", "fetch_activity"))
		body, fetchErr := c.doFetchActivity(ctx, activityID, tokens.AccessToken)
		done(fetchErr)
		if fetchErr == nil {
			return body, nil
		}

		// 404 is not retryable
		if errors.Is(fetchErr, ErrActivityNotFound) {
			return nil, fetchErr
		}

		// 401: refresh token once and retry. A second 401 after refresh
		// means the user likely deauthorized — stop to avoid hammering
		// both Strava's token endpoint and Firestore.
		if isAuthError(fetchErr) {
			if authRefreshed {
				return nil, fmt.Errorf("%w: still unauthorized after token refresh", ErrStravaAuth)
			}
			c.logger.Warn("Strava 401, refreshing token", "activity_id", activityID, "owner_id", ownerID)
			refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens)
			if refreshErr != nil {
				return nil, fmt.Errorf("%w: token refresh failed: %w", ErrStravaAuth, refreshErr)
			}
			tokens = refreshedTokens
			authRefreshed = true
			lastErr = fetchErr
			continue
		}

		lastErr = fetchErr
		if attempt < activityRetryAttempts-1 {
			backoff := activityRetryBackoff * time.Duration(math.Pow(2, float64(attempt)))
			c.logger.Warn("Strava fetch retry",
				"activity_id", activityID,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", fetchErr,
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
func (c *Client) doFetchActivity(ctx context.Context, activityID int64, accessToken string) ([]byte, error) {
	reqURL := fmt.Sprintf("%s/activities/%d", c.apiBase, activityID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

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

// refreshAndPersist refreshes Strava tokens and writes them back to the TokenStore
// using optimistic concurrency. If another goroutine refreshed tokens concurrently,
// the conflict is detected and the winner's tokens are used instead.
//
// Returns error if either the refresh or the write-back fails — callers must not
// proceed with stale tokens if write-back fails.
func (c *Client) refreshAndPersist(ctx context.Context, ownerID int64, tokens *stravatoken.Data) (*stravatoken.Data, error) {
	// Capture the version stamp before calling the external API.
	versionBefore := tokens.LastRefreshed

	var lastErr error
	for attempt := range tokenRetryAttempts {
		done := otel.RecordDuration(ctx, c.histogram, attribute.String("operation", "refresh_token"))
		newTokens, err := c.doRefreshToken(ctx, tokens.RefreshToken)
		done(err)
		if err == nil {
			// Strava may not always return a new refresh token; reuse the existing one.
			if newTokens.RefreshToken == "" {
				newTokens.RefreshToken = tokens.RefreshToken
			}

			// Optimistic write: only succeeds if no concurrent refresh happened.
			writeErr := c.tokenStore.WriteTokensIfUnmodified(ctx, ownerID, newTokens, versionBefore)
			if writeErr != nil {
				if errors.Is(writeErr, ports.ErrTokenConflict) {
					// Another goroutine won the race. Re-read their tokens.
					c.logger.Warn("Token refresh race detected, using competing thread's tokens", "owner_id", ownerID)
					winner, getErr := c.tokenStore.GetTokens(ctx, ownerID)
					if getErr != nil {
						return nil, fmt.Errorf("re-read tokens after conflict for athlete %d: %w", ownerID, getErr)
					}
					return winner, nil
				}
				return nil, fmt.Errorf("write-back tokens for athlete %d: %w", ownerID, writeErr)
			}

			c.logger.Info("Strava access token refreshed", "owner_id", ownerID)
			return newTokens, nil
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
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}
	}
	return nil, fmt.Errorf("token refresh failed after %d attempts: %w", tokenRetryAttempts, lastErr)
}

// doRefreshToken performs a single token refresh request and returns the new tokens.
func (c *Client) doRefreshToken(ctx context.Context, refreshToken string) (*stravatoken.Data, error) {
	form := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body", "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to read token response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenResponse
	if unmarshalErr := json.Unmarshal(body, &tokenResp); unmarshalErr != nil {
		return nil, fmt.Errorf("decode token response: %w", unmarshalErr)
	}

	if tokenResp.AccessToken == "" {
		return nil, errors.New("token response missing access_token")
	}

	return &stravatoken.Data{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    tokenResp.ExpiresAt,
	}, nil
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
