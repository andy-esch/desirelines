// Package strava provides a client for the Strava REST API.
package strava

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Sentinel errors for Strava API failures.
var (
	// ErrActivityNotFound is an alias for ports.ErrActivityNotFound for
	// backward compatibility within this package's tests.
	ErrActivityNotFound = ports.ErrActivityNotFound
	ErrStravaAuth       = errors.New("strava: authentication failed after retry")
	ErrStravaAPI        = errors.New("strava: API error")

	// errRefreshTokenRejected marks a 400/401 response from Strava's
	// /oauth/token endpoint. The stored refresh token itself has been
	// invalidated (revoked, rotated, or wrong), so retrying with the same
	// refresh token will fail the same way — refreshAndPersist treats this
	// as non-retryable and returns immediately.
	errRefreshTokenRejected = errors.New("strava: refresh token rejected")
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

	// maxRetryBackoff caps exponential backoff to prevent excessive waits
	// if retry attempt counts are ever increased.
	maxRetryBackoff = 10 * time.Second

	// httpClientTimeout is the timeout for individual HTTP requests to the Strava API.
	httpClientTimeout = 10 * time.Second

	// Response size limits to prevent memory exhaustion.
	// Activity JSON is typically 5-50KB; 5MB is a generous safety cap.
	// Token responses are a few hundred bytes; 64KB is more than enough.
	maxActivityResponseBytes = 5 << 20  // 5 MB
	maxTokenResponseBytes    = 64 << 10 // 64 KB

	paramClientID     = "client_id"
	paramClientSecret = "client_secret"
	paramRefreshToken = "refresh_token"
	paramGrantType    = "grant_type"
	grantTypeRefresh  = "refresh_token"
)

const (
	// tokenExpirySkew triggers a proactive token refresh this long
	// before the stored access token's nominal expiry. Covers clock
	// drift and in-flight request time; well under Strava's ~6h token
	// lifetime. The reactive 401 path remains a backstop for tokens
	// revoked before their nominal expiry.
	tokenExpirySkew = 5 * time.Minute

	// refresh-reason values identifying what triggered a token refresh.
	// Stamped as the strava.refresh_reason span attribute and the
	// refresh_reason log field. (snake_case / strava.* prefix match the
	// existing convention in this file rather than a bare "refresh.reason".)
	refreshReasonEmptyToken      = "empty_token"
	refreshReasonProactiveExpiry = "proactive_expiry"
	refreshReasonReactive401     = "reactive_401"
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
	tracer       trace.Tracer
}

// Compile-time check that Client implements StravaClient.
var _ ports.StravaClient = (*Client)(nil)

// NewClient creates a new Strava API client.
// OAuth client credentials must be injected by the caller (composition root).
// Per-user tokens are read from the TokenStore on each request.
func NewClient(clientID, clientSecret string, tokenStore ports.TokenStore, logger *slog.Logger, histogram metric.Float64Histogram, tracer trace.Tracer) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout:   httpClientTimeout,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
		clientID:     clientID,
		clientSecret: clientSecret,
		tokenStore:   tokenStore,
		tokenURL:     defaultTokenURL,
		apiBase:      defaultAPIBase,
		logger:       logger,
		histogram:    histogram,
		tracer:       tracer,
	}
}

// proactiveRefreshReason reports why the stored token must be refreshed
// before use, or "" if it is still usable. Drives refresh-ahead: an
// empty token has never been minted; a token at/under the expiry skew
// window is about to expire. Returning "" lets FetchActivity use the
// stored token directly, with the reactive 401 path as a backstop.
func proactiveRefreshReason(tokens *stravatoken.Data, now time.Time) string {
	switch {
	case tokens.AccessToken == "":
		return refreshReasonEmptyToken
	case now.Add(tokenExpirySkew).Unix() >= tokens.ExpiresAt:
		return refreshReasonProactiveExpiry
	default:
		return ""
	}
}

// FetchActivity retrieves the raw JSON for a Strava activity.
// Reads the owner's tokens from the TokenStore, refreshes ahead of
// expiry, retries on transient errors, and refreshes + persists tokens
// reactively on 401 as a backstop.
func (c *Client) FetchActivity(ctx context.Context, ownerID, activityID int64) (_ []byte, err error) {
	ctx, spanDone := otel.StartSpan(ctx, c.tracer, "strava.fetch_activity",
		attribute.Int64("strava.owner_id", ownerID),
		attribute.Int64("strava.activity_id", activityID),
	)
	defer func() { spanDone(err) }()

	cid := gcplog.CorrelationIDFromContext(ctx)

	tokens, err := c.tokenStore.GetTokens(ctx, ownerID)
	if err != nil {
		err = fmt.Errorf("get tokens for athlete %d: %w", ownerID, err)
		return nil, err
	}

	// Refresh-ahead: refresh proactively when there is no stored token
	// or it is at/under the expiry skew window, so we never send a
	// request we already know will 401. The reactive 401 path below
	// remains a backstop for tokens revoked before nominal expiry.
	if reason := proactiveRefreshReason(tokens, time.Now()); reason != "" {
		refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens, reason)
		if refreshErr != nil {
			err = fmt.Errorf("%w: proactive token refresh failed: %w", ErrStravaAuth, refreshErr)
			return nil, err
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
			err = fetchErr
			return nil, err
		}

		// 401: refresh token once and retry. A second 401 after refresh
		// means the user likely deauthorized — stop to avoid hammering
		// both Strava's token endpoint and Firestore.
		if isAuthError(fetchErr) {
			if authRefreshed {
				err = fmt.Errorf("%w: still unauthorized after token refresh", ErrStravaAuth)
				return nil, err
			}
			c.logger.Warn("Strava 401, refreshing token",
				"correlation_id", cid, "activity_id", activityID, "owner_id", ownerID)
			refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens, refreshReasonReactive401)
			if refreshErr != nil {
				err = fmt.Errorf("%w: token refresh failed: %w", ErrStravaAuth, refreshErr)
				return nil, err
			}
			tokens = refreshedTokens
			authRefreshed = true
			lastErr = fetchErr
			continue
		}

		lastErr = fetchErr
		if attempt < activityRetryAttempts-1 {
			nominal := min(activityRetryBackoff*time.Duration(1<<attempt), maxRetryBackoff)
			backoff := jitterBackoff(nominal)
			trace.SpanFromContext(ctx).AddEvent("strava.retry",
				trace.WithAttributes(retryEventAttrs(attempt+1, backoff, fetchErr)...))
			c.logger.Warn("Strava fetch retry",
				"correlation_id", cid,
				"activity_id", activityID,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", fetchErr,
			)
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("strava backoff interrupted: %w", ctx.Err())
			case <-time.After(backoff):
			}
		}
	}

	trace.SpanFromContext(ctx).SetAttributes(
		attribute.Int("strava.attempts", activityRetryAttempts),
		attribute.Bool("strava.exhausted", true),
	)
	err = fmt.Errorf("%w: %w", ErrStravaAPI, lastErr)
	return nil, err
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
			c.logger.Error("Failed to close response body",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx), "error", closeErr)
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
		return nil, &stravaAPIError{statusCode: resp.StatusCode}
	}
}

// refreshAndPersist refreshes Strava tokens and writes them back to the TokenStore
// using optimistic concurrency. If another goroutine refreshed tokens concurrently,
// the conflict is detected and the winner's tokens are used instead.
//
// Returns error if either the refresh or the write-back fails — callers must not
// proceed with stale tokens if write-back fails.
func (c *Client) refreshAndPersist(ctx context.Context, ownerID int64, tokens *stravatoken.Data, reason string) (_ *stravatoken.Data, err error) {
	ctx, spanDone := otel.StartSpan(ctx, c.tracer, "strava.refresh_token",
		attribute.Int64("strava.owner_id", ownerID),
		attribute.String("strava.refresh_reason", reason),
	)
	defer func() { spanDone(err) }()

	cid := gcplog.CorrelationIDFromContext(ctx)

	// Capture the version stamp before calling the external API.
	versionBefore := tokens.LastRefreshed

	var lastErr error
	for attempt := range tokenRetryAttempts {
		done := otel.RecordDuration(ctx, c.histogram, attribute.String("operation", grantTypeRefresh))
		var newTokens *stravatoken.Data
		newTokens, err = c.doRefreshToken(ctx, tokens.RefreshToken)
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
					// Non-fatal (the request still succeeds), so record it as
					// a span attribute rather than an error — it's the signal
					// for "a token race happened during this trace".
					trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.token_conflict", true))
					c.logger.Warn("Token refresh race detected, using competing thread's tokens",
						"correlation_id", cid, "owner_id", ownerID)
					winner, getErr := c.tokenStore.GetTokens(ctx, ownerID)
					if getErr != nil {
						err = fmt.Errorf("re-read tokens after conflict for athlete %d: %w", ownerID, getErr)
						return nil, err
					}
					return winner, nil
				}
				err = fmt.Errorf("write-back tokens for athlete %d: %w", ownerID, writeErr)
				return nil, err
			}

			if newTokens.ExpiresAt == 0 {
				// Without an expiry, refresh-ahead treats the token as
				// expired forever and refreshes on every request — the
				// exact failure mode this strategy exists to prevent.
				// Surface it instead of degrading silently.
				c.logger.Warn("Refreshed Strava token has zero expiry; refresh-ahead will fire on every request until corrected",
					"correlation_id", cid, "owner_id", ownerID, "refresh_reason", reason)
			}

			c.logger.Info("Strava access token refreshed",
				"correlation_id", cid, "owner_id", ownerID, "refresh_reason", reason)
			return newTokens, nil
		}
		// 400/401 from /oauth/token means the refresh token itself has been
		// rejected; retrying with the same token cannot recover. Surface
		// immediately rather than burning a backoff and a second call.
		// strava.refresh_rejected makes this branch filterable in Cloud Trace
		// without log-mining (mirrors strava.token_conflict and the audit's
		// recommendation for the M1 rate-limit case).
		if errors.Is(err, errRefreshTokenRejected) {
			trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.refresh_rejected", true))
			return nil, err
		}
		lastErr = err
		if attempt < tokenRetryAttempts-1 {
			nominal := min(tokenRetryBackoff*time.Duration(1<<attempt), maxRetryBackoff)
			backoff := jitterBackoff(nominal)
			trace.SpanFromContext(ctx).AddEvent("strava.retry",
				trace.WithAttributes(retryEventAttrs(attempt+1, backoff, err)...))
			c.logger.Warn("Token refresh retry",
				"correlation_id", cid,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", err,
			)
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("strava backoff interrupted: %w", ctx.Err())
			case <-time.After(backoff):
			}
		}
	}
	err = fmt.Errorf("token refresh failed after %d attempts: %w", tokenRetryAttempts, lastErr)
	return nil, err
}

// doRefreshToken performs a single token refresh request and returns the new tokens.
func (c *Client) doRefreshToken(ctx context.Context, refreshToken string) (*stravatoken.Data, error) {
	form := url.Values{
		paramClientID:     {c.clientID},
		paramClientSecret: {c.clientSecret},
		paramRefreshToken: {refreshToken},
		paramGrantType:    {grantTypeRefresh},
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
			c.logger.Error("Failed to close response body",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx), "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to read token response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		apiErr := &stravaAPIError{statusCode: resp.StatusCode}
		if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("%w: %w", errRefreshTokenRejected, apiErr)
		}
		return nil, apiErr
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

// stravaAPIError is an internal error for non-auth, non-404 HTTP
// failures from the Strava API. It deliberately carries only the
// status code — the response body is dropped so it can never reach a
// span attribute (docs/architecture/observability.md: "Keep them
// small. Cloud Trace truncates large attribute values").
type stravaAPIError struct {
	statusCode int
}

func (e *stravaAPIError) Error() string {
	return fmt.Sprintf("strava API error: HTTP %d", e.statusCode)
}

// jitterBackoff applies AWS-style full jitter to a nominal exponential
// backoff: returns a uniformly-random duration in [0, nominal). Without
// jitter, concurrent failing requests retry in lockstep, amplifying load
// on a recovering endpoint (AWS Architecture Blog, "Exponential Backoff
// And Jitter", 2015). Mirrored on the Python side in
// `packages/stravapipe/src/stravapipe/retry.py`. A zero or negative
// nominal is returned as 0 — defensive; callers don't produce those.
func jitterBackoff(nominal time.Duration) time.Duration {
	if nominal <= 0 {
		return 0
	}
	// math/rand/v2 is the right choice for backoff jitter — it's a
	// retry-spread mechanism, not a credential. crypto/rand would be
	// 10× slower and pointless here.
	return time.Duration(rand.Int64N(int64(nominal))) //nolint:gosec // non-cryptographic jitter
}

// retryEventAttrs builds the strava.retry span-event attributes. HTTP
// failures contribute a bounded status_code; transport/decode errors
// contribute their (short, body-free) message.
func retryEventAttrs(attempt int, backoff time.Duration, err error) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.Int("attempt", attempt),
		attribute.String("backoff", backoff.String()),
	}
	var apiErr *stravaAPIError
	var authErr *authError
	switch {
	case errors.As(err, &apiErr):
		attrs = append(attrs, attribute.Int("status_code", apiErr.statusCode))
	case errors.As(err, &authErr):
		attrs = append(attrs, attribute.Int("status_code", authErr.statusCode))
	default:
		attrs = append(attrs, attribute.String("error", err.Error()))
	}
	return attrs
}
