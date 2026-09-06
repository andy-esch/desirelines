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
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"github.com/sony/gobreaker/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/sync/singleflight"
)

// Sentinel errors for Strava API failures.
var (
	// ErrActivityNotFound is an alias for ports.ErrActivityNotFound for
	// backward compatibility within this package's tests.
	ErrActivityNotFound = ports.ErrActivityNotFound
	// ErrStravaAuth is an alias for ports.ErrStravaAuthFailed. The port owns the
	// contract because callers outside this package classify on it.
	ErrStravaAuth = ports.ErrStravaAuthFailed
	ErrStravaAPI  = errors.New("strava: API error")

	// errRefreshTokenRejected marks a structured rejection that specifically
	// identifies the athlete's refresh token as invalid. A bare 400/401 is not
	// enough: Strava uses the same statuses for application-credential errors,
	// which must never be interpreted as an athlete revoking access.
	errRefreshTokenRejected = errors.New("strava: refresh token rejected")

	// errCallerContextEnded marks a request cut short by the *caller's*
	// context — the shared per-request budget (handleEventDeadline) expiring
	// or an explicit cancellation — rather than by Strava. The HTTP call sites
	// detect this via ctx.Err() and tag it so the breaker treats it as
	// neutral. It is deliberately distinct from http.Client.Timeout (Strava
	// genuinely slow), which leaves the caller ctx un-expired and must still
	// count as a Strava failure.
	errCallerContextEnded = errors.New("strava: caller context ended before completion")

	// errTokenStoreUnavailable marks a generic/transient Firestore fault from
	// the token-store calls that run *inside* the breakered closure (the
	// refresh write-back and the post-conflict re-read). Those are Firestore's
	// health, not Strava's — tagging them keeps a Firestore hiccup during a
	// refresh burst from tripping the *Strava* breaker (the isolation the
	// GetTokens-before-fetch comment promises). The known token sentinels
	// (ErrTokenConflict, ErrTokenNotFound) are handled separately and still
	// surface through the %w chain.
	errTokenStoreUnavailable = errors.New("strava: token store unavailable")
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

	// maxRetryAfter caps a 429 Retry-After. It bounds the synchronous
	// in-request sleep — Cloud Run's request timeout is 60s, so a longer wait
	// can't be honored anyway (the request would be killed mid-sleep) — and
	// guards against int64 overflow from a pathological header. Values at/under
	// this still override the static maxRetryBackoff; a larger ask is clamped.
	maxRetryAfter = 60 * time.Second

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
	// Circuit-breaker thresholds for outbound Strava-API calls.
	// Combined with retry: breaker wraps retry, so the breaker counts
	// exhausted operations (not individual HTTP failures), per Microsoft's
	// "Combining the Circuit Breaker pattern with the Retry pattern"
	// guidance and the audit's 2026-05-28-arch-failure-modes M1 follow-up.
	// 5 consecutive operations failing is a strong signal Strava itself
	// is down; 30s open-state gives the dependency time to recover before
	// half-open probes.
	breakerFailureThreshold = 5
	breakerOpenTimeout      = 30 * time.Second

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
	// refreshReasonDeauthVerify marks the refresh VerifyGrant uses to
	// probe whether a deauthorization event is genuine (see that method).
	refreshReasonDeauthVerify = "deauth_verify"
)

// tokenResponse represents the JSON response from Strava's OAuth token endpoint.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

// oauthErrorResponse is the non-secret portion of Strava's OAuth error body.
// It is parsed only to distinguish an athlete refresh-token rejection from an
// application/configuration rejection; the body is never logged or returned.
type oauthErrorResponse struct {
	Errors []struct {
		Resource string `json:"resource"`
		Field    string `json:"field"`
		Code     string `json:"code"`
	} `json:"errors"`
}

type athleteResponse struct {
	ID int64 `json:"id"`
}

// Client implements ports.StravaClient by calling the Strava REST API.
// Stateless wrt per-user tokens (read from the TokenStore on each call),
// but holds a *shared* circuit breaker whose state is process-wide for
// the service instance — so a Strava outage trips once and fails-fast
// for every concurrent caller until the dependency recovers.
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
	breaker      *gobreaker.CircuitBreaker[[]byte]
	// refreshGroup collapses concurrent token refreshes for the same athlete
	// onto a single outbound /oauth/token call. See refreshAndPersist.
	refreshGroup singleflight.Group
}

// Compile-time check that Client implements StravaClient.
var _ ports.StravaClient = (*Client)(nil)

// NewClient creates a new Strava API client.
// OAuth client credentials must be injected by the caller (composition root).
// Per-user tokens are read from the TokenStore on each request.
func NewClient(
	clientID, clientSecret string,
	tokenStore ports.TokenStore,
	logger *slog.Logger,
	histogram metric.Float64Histogram,
	breakerStateCounter metric.Int64Counter,
	tracer trace.Tracer,
) *Client {
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
		breaker:      newStravaBreaker(logger, breakerOpenTimeout, breakerStateCounter),
	}
}

// newStravaBreaker builds the circuit breaker shared across all Strava
// outbound calls on a Client. `timeout` parameterizes the open-state
// duration so tests can use a short value; production calls pass
// breakerOpenTimeout (30s).
//
// stateCounter may be nil (tests, or a failed instrument construction); the
// state-change hook nil-guards it, matching the handler's counter convention.
func newStravaBreaker(
	logger *slog.Logger,
	timeout time.Duration,
	stateCounter metric.Int64Counter,
) *gobreaker.CircuitBreaker[[]byte] {
	return gobreaker.NewCircuitBreaker[[]byte](gobreaker.Settings{
		Name:    "strava-api",
		Timeout: timeout,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= breakerFailureThreshold
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			logger.Warn("Strava circuit breaker state change",
				"breaker", name,
				"from", from.String(),
				"to", to.String(),
			)
			if stateCounter == nil {
				return
			}
			// gobreaker gives the hook no context, and a state change is not
			// request-scoped anyway — it is a property of the breaker, not of
			// whichever unlucky call tripped it. Background() is correct here.
			//
			// Both `from` and `to` are recorded: "how many times did we open"
			// needs `to`, but distinguishing a genuine recovery
			// (half-open -> closed) from a flap (open -> half-open -> open)
			// needs the pair.
			stateCounter.Add(context.Background(), 1, metric.WithAttributes(
				attribute.String("breaker", name),
				attribute.String("from", from.String()),
				attribute.String("to", to.String()),
			))
		},
		IsSuccessful: isStravaCallSuccessful,
	})
}

// isStravaCallSuccessful returns true when an outcome should NOT count
// as a Strava-side failure — i.e., it's a per-request signal (404/auth/
// caller-canceled) rather than evidence that Strava itself is down.
// Name matches gobreaker's “Settings.IsSuccessful“ parameter: the
// breaker calls this "successful" because it tracks outcomes that look
// healthy from the dependency's perspective, even if the caller saw an
// error.
func isStravaCallSuccessful(err error) bool {
	// Hot path first: a successful call is the vast majority of outcomes, so
	// return before any reflection-based errors.As/errors.Is work.
	if err == nil {
		return true
	}
	// 429 — our quota is exceeded, not evidence that Strava is down.
	// Tripping the breaker on rate-limit doesn't help (Strava is fine,
	// we just used too much) and the retry layer already honors the
	// Retry-After header. Mirrors the Python side's
	// `StravaRateLimitError` entry in `create_strava_breaker`'s
	// exclude list.
	var rlErr *rateLimitError
	if errors.As(err, &rlErr) {
		return true
	}
	// Belt-and-suspenders: 429 now surfaces as *rateLimitError, but keep the
	// old status-code check in case any path still yields a 429 this way.
	var apiErr *stravaAPIError
	if errors.As(err, &apiErr) && apiErr.statusCode == http.StatusTooManyRequests {
		return true
	}
	switch {
	case errors.Is(err, ports.ErrActivityNotFound):
		// 404 — the activity doesn't exist. Strava is fine.
		return true
	case errors.Is(err, ErrStravaAuth):
		// 401 after refresh — the user's tokens are bad. Strava is fine.
		return true
	case errors.Is(err, errRefreshTokenRejected):
		// Refresh token rejected at /oauth/token. Per-user, not Strava.
		return true
	case errors.Is(err, ports.ErrTokenNotFound):
		// Tokens deleted mid-refresh (deauth/refresh race). Per-user, not Strava.
		return true
	case errors.Is(err, errTokenStoreUnavailable):
		// Generic Firestore fault on the in-breaker token write-back / re-read.
		// Firestore's health, not Strava's — must not trip the Strava breaker.
		return true
	case errors.Is(err, context.Canceled):
		// Caller canceled the context — no signal about Strava's health.
		return true
	case errors.Is(err, errCallerContextEnded):
		// The caller's request budget/deadline ended the call (e.g. a slow
		// upstream token read ate the shared handleEventDeadline budget, then
		// the in-flight HTTP call hit the parent-ctx deadline). Not Strava's
		// fault. The HTTP call sites tag this via ctx.Err(); a genuine Strava
		// hang (http.Client.Timeout) leaves the caller ctx live and falls
		// through to the default below.
		return true
	default:
		// 5xx / network / decode / Strava-side timeout → Strava failure.
		// A context.DeadlineExceeded reaching *here* is http.Client.Timeout
		// (httpClientTimeout = 10s): Strava couldn't answer in time, which IS
		// evidence the dependency is degraded. Caller-budget deadlines are
		// tagged errCallerContextEnded above (handleEventDeadline ==
		// httpClientTimeout == 10s, so they are NOT orders of magnitude apart)
		// and never reach this branch.
		return false
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

	// GetTokens hits Firestore, not Strava — keep it outside the breaker
	// so a Firestore outage doesn't trip the Strava circuit.
	tokens, err := c.tokenStore.GetTokens(ctx, ownerID)
	if err != nil {
		err = fmt.Errorf("get tokens for athlete %d: %w", ownerID, err)
		return nil, err
	}

	// Breaker wraps the retry loop (not vice versa): the breaker counts
	// exhausted *operations* as failures, not individual HTTP attempts,
	// which is what Microsoft's combined-pattern guidance prescribes.
	body, err := c.breaker.Execute(func() ([]byte, error) {
		return c.fetchActivityWithTokens(ctx, ownerID, activityID, tokens)
	})
	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		// Fail-fast path: Strava is presumed down. Surface as ErrStravaAPI
		// so the dispatcher handler treats it as transient (500 → Strava
		// retries), but stamp the span so the breaker-open case is
		// filterable in Cloud Trace without log-mining.
		trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.breaker_open", true))
		err = fmt.Errorf("%w: circuit breaker open: %w", ErrStravaAPI, err)
		return nil, err
	}
	return body, err
}

// VerifyGrant confirms an unsigned deauthorization event without turning it
// into a token-rotation or quota-amplification primitive. A live, unexpired
// access token is checked with the read-only /athlete endpoint. Only an expired
// or rejected access token requires a refresh.
//
// A refresh-token rejection authorizes deletion only when Strava's structured
// error identifies that token (not the application credentials) and an
// authoritative token-store re-read still contains the rejected credentials.
// That second read rules out an out-of-process re-authorization hidden behind
// this process's cache.
func (c *Client) VerifyGrant(ctx context.Context, ownerID int64) (_ ports.GrantStatus, err error) {
	ctx, spanDone := otel.StartSpan(ctx, c.tracer, "strava.verify_grant",
		attribute.Int64("strava.owner_id", ownerID),
	)
	defer func() { spanDone(err) }()

	tokens, err := c.tokenStore.GetTokens(ctx, ownerID)
	if err != nil {
		return ports.GrantUnknown, fmt.Errorf("get tokens for athlete %d: %w", ownerID, err)
	}
	return c.verifyGrantWithTokens(ctx, ownerID, tokens, true)
}

func (c *Client) verifyGrantWithTokens(ctx context.Context, ownerID int64, tokens *stravatoken.Data, rereadOnRejection bool) (ports.GrantStatus, error) {
	// Avoid rotating a healthy token for every forged webhook. If the access
	// token is nominally live, /athlete is a cheap, read-only proof that it still
	// belongs to this owner. A 401 falls through to the stronger refresh check.
	if tokens.AccessToken != "" && time.Now().Unix() < tokens.ExpiresAt {
		// Timed like every other outbound Strava op. Without this the deauth
		// path was absent from strava.api.duration entirely, so the histogram
		// under-counted real Strava traffic and a slow /athlete was invisible.
		done := otel.RecordDuration(ctx, c.histogram, attribute.String("operation", "verify_athlete"))
		verifyErr := c.doVerifyCurrentAthlete(ctx, ownerID, tokens.AccessToken)
		done(verifyErr)
		if verifyErr == nil {
			return ports.GrantActive, nil
		} else if !isAuthError(verifyErr) {
			return ports.GrantUnknown, fmt.Errorf("verify current athlete %d: %w", ownerID, verifyErr)
		}
	}

	if _, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens, refreshReasonDeauthVerify); refreshErr == nil {
		return ports.GrantActive, nil
	} else if !errors.Is(refreshErr, errRefreshTokenRejected) {
		return ports.GrantUnknown, fmt.Errorf("verify grant for athlete %d: %w", ownerID, refreshErr)
	}

	if !rereadOnRejection {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.grant_revoked", true))
		return ports.GrantRevoked, nil
	}

	// refreshAndPersist invalidates caching stores on this exact rejection. The
	// next read is therefore authoritative and catches a fresh token written by
	// another process (for example, an API-gateway re-authorization).
	fresh, getErr := c.tokenStore.GetTokens(ctx, ownerID)
	if getErr != nil {
		return ports.GrantUnknown, fmt.Errorf("re-read tokens after rejected grant check for athlete %d: %w", ownerID, getErr)
	}
	if sameGrantCredentials(tokens, fresh) {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.grant_revoked", true))
		return ports.GrantRevoked, nil
	}
	return c.verifyGrantWithTokens(ctx, ownerID, fresh, false)
}

func sameGrantCredentials(a, b *stravatoken.Data) bool {
	return a.AccessToken == b.AccessToken &&
		a.RefreshToken == b.RefreshToken &&
		a.ExpiresAt == b.ExpiresAt &&
		a.LastRefreshed.Equal(b.LastRefreshed)
}

// doVerifyCurrentAthlete proves a live access token belongs to ownerID.
func (c *Client) doVerifyCurrentAthlete(ctx context.Context, ownerID int64, accessToken string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiBase+"/athlete", nil)
	if err != nil {
		return fmt.Errorf("create athlete request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return wrapHTTPErr(ctx, err, "athlete request failed")
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx), "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return wrapHTTPErr(ctx, err, "read athlete response body")
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var athlete athleteResponse
		if decodeErr := json.Unmarshal(body, &athlete); decodeErr != nil {
			return fmt.Errorf("decode athlete response: %w", decodeErr)
		}
		if athlete.ID != ownerID {
			return fmt.Errorf("access token identifies athlete %d, want %d", athlete.ID, ownerID)
		}
		return nil
	case http.StatusUnauthorized:
		return &authError{statusCode: resp.StatusCode}
	case http.StatusTooManyRequests:
		return &rateLimitError{retryAfter: parseRetryAfter(resp.Header.Get("Retry-After"))}
	default:
		return &stravaAPIError{statusCode: resp.StatusCode}
	}
}

// fetchActivityWithTokens runs the proactive-refresh + retry-loop body
// that talks to Strava. Extracted so `FetchActivity` can wrap it with
// the circuit breaker; on its own it has no breaker awareness.
func (c *Client) fetchActivityWithTokens(ctx context.Context, ownerID, activityID int64, tokens *stravatoken.Data) ([]byte, error) {
	cid := gcplog.CorrelationIDFromContext(ctx)

	// Refresh-ahead: refresh proactively when there is no stored token
	// or it is at/under the expiry skew window, so we never send a
	// request we already know will 401. The reactive 401 path below
	// remains a backstop for tokens revoked before nominal expiry.
	if reason := proactiveRefreshReason(tokens, time.Now()); reason != "" {
		refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens, reason)
		if refreshErr != nil {
			// Only wrap as ErrStravaAuth when the underlying cause is a
			// permanent rejection of the refresh token (revoked, rotated,
			// or wrong). Transient failures (network errors, OAuth-endpoint
			// 5xx, decode errors) must propagate as their own type so:
			//   - the circuit breaker counts them as Strava-side failures
			//     (ErrStravaAuth is excluded by isStravaCallSuccessful)
			//   - the caller does not treat a temporary Strava outage as
			//     evidence the user's refresh token is dead (which would
			//     drive false re-link prompts at multi-user scale)
			if errors.Is(refreshErr, errRefreshTokenRejected) {
				return nil, fmt.Errorf("%w: proactive token refresh failed: %w", ErrStravaAuth, refreshErr)
			}
			return nil, fmt.Errorf("proactive token refresh failed: %w", refreshErr)
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
			c.logger.Warn("Strava 401, refreshing token",
				"correlation_id", cid, "activity_id", activityID, "owner_id", ownerID)
			refreshedTokens, refreshErr := c.refreshAndPersist(ctx, ownerID, tokens, refreshReasonReactive401)
			if refreshErr != nil {
				// Same wrapping rule as the proactive path above — see
				// comment there for the full rationale.
				if errors.Is(refreshErr, errRefreshTokenRejected) {
					return nil, fmt.Errorf("%w: token refresh failed: %w", ErrStravaAuth, refreshErr)
				}
				return nil, fmt.Errorf("token refresh failed: %w", refreshErr)
			}
			tokens = refreshedTokens
			authRefreshed = true
			lastErr = fetchErr
			continue
		}

		lastErr = fetchErr

		// On 429, stamp the span so rate-limited fetches stay filterable in
		// Cloud Trace even when the loop exhausts (stamped before the
		// retry-vs-give-up branch below).
		stampRateLimited(ctx, fetchErr)

		if attempt < activityRetryAttempts-1 {
			backoff := stampRetryBackoff(ctx, attempt, activityRetryBackoff, fetchErr)
			c.logger.Warn("Strava fetch retry",
				"correlation_id", cid,
				"activity_id", activityID,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", fetchErr,
			)
			if waitErr := waitBeforeRetry(ctx, backoff, lastErr); waitErr != nil {
				return nil, waitErr
			}
		}
	}

	trace.SpanFromContext(ctx).SetAttributes(
		attribute.Int("strava.attempts", activityRetryAttempts),
		attribute.Bool("strava.exhausted", true),
	)
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
		return nil, wrapHTTPErr(ctx, err, "http request failed")
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx), "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxActivityResponseBytes))
	if err != nil {
		return nil, wrapHTTPErr(ctx, err, "read response body")
	}

	switch resp.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusNotFound:
		return nil, ErrActivityNotFound
	case http.StatusUnauthorized:
		return nil, &authError{statusCode: resp.StatusCode}
	case http.StatusTooManyRequests:
		return nil, &rateLimitError{retryAfter: parseRetryAfter(resp.Header.Get("Retry-After"))}
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
// refreshAndPersist serializes refreshes per athlete, then delegates to
// refreshAndPersistOnce.
//
// The optimistic write-back guards the *write*; it does nothing about the
// *call*. Two webhooks for one athlete can both read the same stored tokens,
// both decide to refresh, and both POST the same refresh_token to Strava before
// either write-back runs. Strava rotates refresh tokens, and replaying a
// just-consumed one is the canonical OAuth rotation hazard (RFC 6819 §5.2.2.3):
// at best the loser's result is discarded by the write conflict, at worst the
// provider treats the replay as theft and revokes the grant.
//
// singleflight closes that window by collapsing concurrent callers onto one
// call and sharing its result. In-process state is sufficient for the same
// reason the token cache is: the dispatcher runs single-instance. Raising
// max_instance_count would reopen this across instances — see the checklist in
// cloud_run.tf.
//
// Caveat worth knowing: sharers inherit the winner's outcome, including a
// cancellation. A caller whose own context is still live can therefore see the
// winner's context error. That is preferable to the replay it prevents, and the
// next webhook redelivery retries.
func (c *Client) refreshAndPersist(ctx context.Context, ownerID int64, tokens *stravatoken.Data, reason string) (*stravatoken.Data, error) {
	v, err, shared := c.refreshGroup.Do(strconv.FormatInt(ownerID, 10), func() (any, error) {
		return c.refreshAndPersistOnce(ctx, ownerID, tokens, reason)
	})
	if shared {
		// Mirrors strava.token_conflict: makes a collapsed refresh filterable in
		// Cloud Trace, so the rate of real concurrency is observable rather than
		// assumed. Set for every participant, winner included — the attribute
		// means "this refresh was shared", not "this caller lost".
		trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.refresh_singleflight_shared", true))
	}
	if err != nil {
		// singleflight hands back the inner error verbatim; %w keeps the chain so
		// callers can still errors.Is on ErrTokenNotFound, errRefreshTokenRejected
		// and friends, which they branch on.
		return nil, fmt.Errorf("refresh tokens for athlete %d: %w", ownerID, err)
	}
	refreshed, ok := v.(*stravatoken.Data)
	if !ok {
		return nil, fmt.Errorf("refresh for athlete %d returned %T, want *stravatoken.Data", ownerID, v)
	}
	return refreshed, nil
}

func (c *Client) refreshAndPersistOnce(ctx context.Context, ownerID int64, tokens *stravatoken.Data, reason string) (_ *stravatoken.Data, err error) {
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
			writeErr := c.persistRefreshedTokens(ctx, ownerID, newTokens, versionBefore)
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
						// Firestore fault (not Strava) — tag so the breaker stays
						// neutral. An inner ErrTokenNotFound still matches via %w.
						err = fmt.Errorf("%w: re-read tokens after conflict for athlete %d: %w", errTokenStoreUnavailable, ownerID, getErr)
						return nil, err
					}
					return winner, nil
				}
				if errors.Is(writeErr, ports.ErrTokenNotFound) {
					// Tokens were deleted mid-refresh (deauth/refresh race).
					// Propagate the sentinel so the handler treats it as
					// orphan (ack 200) instead of looping through Strava
					// retries.
					err = writeErr
					return nil, err
				}
				// Generic/transient Firestore fault on write-back, still failing
				// after the bounded retry in persistRefreshedTokens (the known
				// ErrTokenConflict / ErrTokenNotFound sentinels were handled
				// above). Tag as token-store-unavailable so the breaker treats
				// it as Firestore's health, not Strava's.
				//
				// This is the expensive failure: Strava minted new tokens and we
				// could not store them, so if Strava rotated the refresh token
				// the stored one is now dead and the grant needs re-linking. Mark
				// it distinctly — without this it is indistinguishable in Cloud
				// Trace from a benign transient read fault, which is why the
				// original audit could not tell how often it fires.
				trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("strava.token_writeback_lost", true))
				c.logger.Error("Refreshed Strava tokens could not be persisted; the grant may need re-linking",
					"correlation_id", cid, "owner_id", ownerID, "error", writeErr)
				err = fmt.Errorf("%w: write-back tokens for athlete %d: %w", errTokenStoreUnavailable, ownerID, writeErr)
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
			// The tokens we read are known-bad: Strava rejected the refresh token.
			// If the store caches reads, drop the entry so the next attempt re-reads
			// Firestore rather than re-serving the poison for a full TTL — the
			// apigateway may already have written fresh tokens on re-auth (a write
			// this in-process cache can't see). No-op on a non-caching store.
			if inv, ok := c.tokenStore.(ports.TokenInvalidator); ok {
				inv.Invalidate(ownerID)
			}
			return nil, err
		}
		lastErr = err

		stampRateLimited(ctx, err)

		if attempt < tokenRetryAttempts-1 {
			backoff := stampRetryBackoff(ctx, attempt, tokenRetryBackoff, err)
			c.logger.Warn("Token refresh retry",
				"correlation_id", cid,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", err,
			)
			if waitErr := waitBeforeRetry(ctx, backoff, lastErr); waitErr != nil {
				return nil, waitErr
			}
		}
	}
	err = fmt.Errorf("token refresh failed after %d attempts: %w", tokenRetryAttempts, lastErr)
	return nil, err
}

// persistRefreshedTokens writes freshly-minted tokens with a bounded retry.
//
// The refresh call itself was already retried; without this the *persist* step
// had none, which inverts the retry budget against the cost of failure. Losing
// the outbound call is recoverable — the next webhook redelivery just refreshes
// again. Losing the write-back is not: Strava may have rotated the refresh
// token, so the one still in Firestore is dead and the athlete has to re-link.
//
// Retrying is safe under both failure modes. If the first write never landed,
// the retry re-writes against the unchanged versionBefore and succeeds. If it
// did land but the response was lost (ambiguous commit), the retry sees
// last_refreshed already moved, returns ErrTokenConflict, and the caller's
// existing conflict path re-reads what is in fact our own write.
//
// ErrTokenConflict and ErrTokenNotFound are terminal by design: both mean the
// world changed underneath us, and repeating the write cannot fix either.
func (c *Client) persistRefreshedTokens(
	ctx context.Context,
	ownerID int64,
	newTokens *stravatoken.Data,
	versionBefore time.Time,
) error {
	var writeErr error
	for attempt := range tokenRetryAttempts {
		writeErr = c.tokenStore.WriteTokensIfUnmodified(ctx, ownerID, newTokens, versionBefore)
		if writeErr == nil {
			return nil
		}
		if errors.Is(writeErr, ports.ErrTokenConflict) || errors.Is(writeErr, ports.ErrTokenNotFound) {
			// %w, not a bare return: the caller branches on both sentinels with
			// errors.Is, so the chain has to survive the wrap.
			return fmt.Errorf("write tokens: %w", writeErr)
		}
		if attempt < tokenRetryAttempts-1 {
			backoff := min(tokenRetryBackoff*time.Duration(1<<attempt), maxRetryBackoff)
			c.logger.Warn("Token write-back retry",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx),
				"owner_id", ownerID,
				"attempt", attempt+1,
				"backoff", backoff,
				"error", writeErr,
			)
			select {
			case <-ctx.Done():
				return fmt.Errorf("token write-back interrupted: %w (cause: %w)", ctx.Err(), writeErr)
			case <-time.After(backoff):
			}
		}
	}
	return fmt.Errorf("write tokens after %d attempts: %w", tokenRetryAttempts, writeErr)
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
		return nil, wrapHTTPErr(ctx, err, "token request failed")
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body",
				"correlation_id", gcplog.CorrelationIDFromContext(ctx), "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return nil, wrapHTTPErr(ctx, err, "failed to read token response body")
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		// Token endpoint is rate-limited — honor Retry-After in the retry
		// loop rather than burning a static backoff on a call we know 429s.
		return nil, &rateLimitError{retryAfter: parseRetryAfter(resp.Header.Get("Retry-After"))}
	}
	if resp.StatusCode != http.StatusOK {
		apiErr := &stravaAPIError{statusCode: resp.StatusCode}
		if (resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized) && isRefreshTokenInvalid(body) {
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

func isRefreshTokenInvalid(body []byte) bool {
	var response oauthErrorResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return false
	}
	for _, apiErr := range response.Errors {
		if apiErr.Resource == "RefreshToken" &&
			(apiErr.Field == paramRefreshToken || apiErr.Field == "code") &&
			apiErr.Code == "invalid" {
			return true
		}
	}
	return false
}

// wrapHTTPErr classifies a failed HTTP call or body read against the caller's
// context. A non-nil ctx.Err() means the caller's budget or cancellation ended
// the call, not that Strava was slow — http.Client.Timeout leaves ctx.Err()
// nil — so tag it errCallerContextEnded to keep the circuit breaker neutral.
// Anything else is Strava's failure and keeps the call site's own msg.
func wrapHTTPErr(ctx context.Context, err error, msg string) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return fmt.Errorf("%w: %w", errCallerContextEnded, ctxErr)
	}
	return fmt.Errorf("%s: %w", msg, err)
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

// rateLimitError marks a 429 from Strava. retryAfter carries the parsed
// Retry-After delay (0 when absent/unparseable, clamped to maxRetryAfter). The retry
// loops floor their backoff at retryAfter — Strava is the authority on quota
// timing — and isStravaCallSuccessful treats this as a per-quota signal, not
// evidence Strava is down, so 429s never trip the circuit breaker.
type rateLimitError struct {
	retryAfter time.Duration
}

func (e *rateLimitError) Error() string {
	return fmt.Sprintf("strava 429 rate limited (retry_after=%s)", e.retryAfter)
}

// parseRetryAfter parses a Retry-After header in delta-seconds form
// (RFC 7231 §7.1.3). The HTTP-date form is spec-legal but Strava emits
// delta-seconds in practice — fall back to 0 on an absent, negative, or
// unparseable value so the static backoff dominates rather than the caller
// tripping on a bad header. The result is clamped to maxRetryAfter.
func parseRetryAfter(h string) time.Duration {
	if h == "" {
		return 0
	}
	secs, err := strconv.Atoi(h)
	if err != nil || secs < 0 {
		return 0
	}
	// Compare in seconds *before* multiplying to nanoseconds, so a pathological
	// header (e.g. "99999999999") can't overflow the int64 Duration.
	if secs >= int(maxRetryAfter/time.Second) {
		return maxRetryAfter
	}
	return time.Duration(secs) * time.Second
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

// retryBackoff is the sleep before the next attempt: full-jittered
// exponential backoff (nominal already capped by the caller). On a
// *rateLimitError it honors Strava's Retry-After as a floor — we never sleep
// *less* than Strava asked (sleeping the 10s static cap when Strava said 60s
// just guarantees another 429) — but adds jitter *on top* of that floor so a
// burst of concurrent rate-limited retries (e.g. a backfill that all 429 with
// the same Retry-After) doesn't resynchronize and immediately re-trip the
// limit. Result is always >= retryAfter.
func retryBackoff(nominal time.Duration, err error) time.Duration {
	jittered := jitterBackoff(nominal)
	var rlErr *rateLimitError
	if errors.As(err, &rlErr) && rlErr.retryAfter > jittered {
		return rlErr.retryAfter + jittered
	}
	return jittered
}

// stampRateLimited records the rate-limit span attributes when err is a
// *rateLimitError, so 429s are filterable in Cloud Trace even when the retry
// loop exhausts. No-op for any other error. Attributes are bounded scalars
// (bool + int) per docs/architecture/observability.md.
func stampRateLimited(ctx context.Context, err error) {
	var rlErr *rateLimitError
	if errors.As(err, &rlErr) {
		trace.SpanFromContext(ctx).SetAttributes(
			attribute.Bool("strava.rate_limited", true),
			attribute.Int64("strava.retry_after_ms", rlErr.retryAfter.Milliseconds()),
		)
	}
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
	var rlErr *rateLimitError
	switch {
	case errors.As(err, &rlErr):
		attrs = append(attrs, attribute.Int("status_code", http.StatusTooManyRequests))
	case errors.As(err, &apiErr):
		attrs = append(attrs, attribute.Int("status_code", apiErr.statusCode))
	case errors.As(err, &authErr):
		attrs = append(attrs, attribute.Int("status_code", authErr.statusCode))
	default:
		attrs = append(attrs, attribute.String("error", err.Error()))
	}
	return attrs
}

// stampRetryBackoff derives the sleep before the next attempt — exponential
// from base, capped at maxRetryBackoff, then jittered (and floored at a 429's
// Retry-After) by retryBackoff — and records the strava.retry span event for
// it. The backoff is returned rather than slept on here so each retry loop can
// log it with its own fields before handing it to waitBeforeRetry.
func stampRetryBackoff(ctx context.Context, attempt int, base time.Duration, err error) time.Duration {
	nominal := min(base*time.Duration(1<<attempt), maxRetryBackoff)
	backoff := retryBackoff(nominal, err)
	trace.SpanFromContext(ctx).AddEvent("strava.retry",
		trace.WithAttributes(retryEventAttrs(attempt+1, backoff, err)...))
	return backoff
}

// waitBeforeRetry sleeps out the backoff, returning non-nil if the caller's
// context ended first. The wrap preserves cause (e.g. *rateLimitError) so a
// retry cut short by the request budget is classified by *why* we were
// retrying, not mis-counted as a Strava failure for the bare ctx.Err(). A real
// 5xx cause still falls to the breaker's failure default.
func waitBeforeRetry(ctx context.Context, backoff time.Duration, cause error) error {
	select {
	case <-ctx.Done():
		return fmt.Errorf("strava backoff interrupted: %w (cause: %w)", ctx.Err(), cause)
	case <-time.After(backoff):
	}
	return nil
}
