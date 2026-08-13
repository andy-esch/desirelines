package strava

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"github.com/sony/gobreaker/v2"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// futureExpiry is well beyond tokenExpirySkew, so proactiveRefreshReason
// returns "" and FetchActivity uses the stored token directly. Tests that
// exercise the direct-fetch or reactive-401 paths must set this, otherwise
// the new refresh-ahead logic refreshes before every fetch.
func futureExpiry() int64 { return time.Now().Add(time.Hour).Unix() }

// pastExpiry is in the past, so proactiveRefreshReason returns
// "proactive_expiry".
func pastExpiry() int64 { return time.Now().Add(-time.Hour).Unix() }

// newRecordingTestClient is newTestClient with a real SDK tracer feeding a
// SpanRecorder, so tests can assert span attributes/events.
func newRecordingTestClient(server *httptest.Server, tokenStore ports.TokenStore) (*Client, *tracetest.SpanRecorder) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	c := newTestClient(server, tokenStore)
	c.tracer = tp.Tracer("test")
	return c, sr
}

// spanByName returns the first ended span with the given name.
func spanByName(t *testing.T, sr *tracetest.SpanRecorder, name string) sdktrace.ReadOnlySpan {
	t.Helper()
	for _, s := range sr.Ended() {
		if s.Name() == name {
			return s
		}
	}
	t.Fatalf("no ended span named %q (got %d spans)", name, len(sr.Ended()))
	return nil
}

// spanAttrString returns the string value of a span attribute, or "".
func spanAttrString(s sdktrace.ReadOnlySpan, key string) string {
	for _, a := range s.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsString()
		}
	}
	return ""
}

// spanAttrInt returns the int64 value of a span attribute, or 0.
func spanAttrInt(s sdktrace.ReadOnlySpan, key string) int64 {
	for _, a := range s.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsInt64()
		}
	}
	return 0
}

// spanAttrBool returns the bool value of a span attribute, or false.
func spanAttrBool(s sdktrace.ReadOnlySpan, key string) bool {
	for _, a := range s.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsBool()
		}
	}
	return false
}

// assertHTTPRetryEvent verifies a strava.retry event for an HTTP
// failure: attempt present, a bounded status_code, no free-form error
// string (P1 — response bodies must not reach span attributes), and a
// 'backoff' that parses as a duration in [0, maxRetryBackoff). The
// backoff attribute is the actual (post-jitter) sleep, not the nominal
// exponential value.
func assertHTTPRetryEvent(t *testing.T, e sdktrace.Event, wantStatus int64) {
	t.Helper()
	var sawAttempt, sawError, sawBackoff bool
	var gotStatus int64
	var gotBackoff time.Duration
	for _, a := range e.Attributes {
		switch string(a.Key) {
		case "attempt":
			sawAttempt = true
		case "status_code":
			gotStatus = a.Value.AsInt64()
		case "error":
			sawError = true
		case "backoff":
			sawBackoff = true
			d, err := time.ParseDuration(a.Value.AsString())
			if err != nil {
				t.Errorf("strava.retry backoff %q does not parse as duration: %v", a.Value.AsString(), err)
			}
			gotBackoff = d
		}
	}
	if !sawAttempt {
		t.Errorf("strava.retry missing 'attempt' attribute: %+v", e.Attributes)
	}
	if gotStatus != wantStatus {
		t.Errorf("strava.retry status_code = %d, want %d", gotStatus, wantStatus)
	}
	if sawError {
		t.Error("strava.retry carried a free-form 'error' for an HTTP failure; expected status_code only")
	}
	if !sawBackoff {
		t.Errorf("strava.retry missing 'backoff' attribute: %+v", e.Attributes)
	}
	// Full-jitter sleep is in [0, nominal) and nominal is capped at
	// maxRetryBackoff, so the actual recorded sleep must respect that
	// ceiling. Catches regressions where jitter is dropped (would
	// record the full exponential, e.g. 4s on attempt 3) or the cap
	// is bypassed.
	if gotBackoff < 0 || gotBackoff >= maxRetryBackoff {
		t.Errorf("strava.retry backoff = %v, want in [0, %v)", gotBackoff, maxRetryBackoff)
	}
}

const (
	testOwnerID         int64 = 67890
	testActivityPath          = "/api/v3/activities/12345"
	testTokenPath             = "/oauth/token" //nolint:gosec // URL path, not credential
	testActivityID      int64 = 12345
	testSmallActivityID int64 = 1
)

// testBreakerTimeout shortens the open-state cool-off so breaker tests
// don't sleep the production 30s waiting for half-open.
const testBreakerTimeout = 50 * time.Millisecond

// newTestClient creates a Client pointing at the given test server with a token store.
func newTestClient(server *httptest.Server, tokenStore ports.TokenStore) *Client {
	noopProviders := otel.NoopProviders()
	noopHist, _ := noopProviders.Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
	logger := gcplog.NewNoOpLogger()
	return &Client{
		httpClient:   server.Client(),
		clientID:     "test-id",
		clientSecret: "test-secret",
		tokenStore:   tokenStore,
		tokenURL:     server.URL + testTokenPath,
		apiBase:      server.URL + "/api/v3",
		logger:       logger,
		histogram:    noopHist,
		tracer:       noopProviders.Tracer,
		breaker:      newStravaBreaker(logger, testBreakerTimeout),
	}
}

func TestFetchActivity_Success(t *testing.T) {
	expectedBody := `{"id":12345,"name":"Morning Run","distance":5000}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == testActivityPath {
			auth := r.Header.Get("Authorization")
			if auth != "Bearer test-access-token" {
				t.Errorf("unexpected Authorization header: %s", auth)
			}
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(expectedBody)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
			return
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, 12345)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != expectedBody {
		t.Errorf("body = %s, want %s", string(body), expectedBody)
	}
}

func TestFetchActivity_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		if _, err := w.Write([]byte(`{"message":"Record Not Found"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, 99999)
	if err == nil {
		t.Fatal("expected error for 404")
	}
	if !errors.Is(err, ErrActivityNotFound) {
		t.Errorf("expected ErrActivityNotFound, got %v", err)
	}
}

// new401ThenSuccessServer creates an httptest.Server that returns 401 on the first activity
// request (triggering a token refresh), then succeeds on the retry with the expected token.
// The token endpoint returns the given refreshedAccess/refreshedRefresh tokens.
func new401ThenSuccessServer(t *testing.T, oldToken, refreshedAccess, refreshedRefresh string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var callCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  refreshedAccess,
				"refresh_token": refreshedRefresh,
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			count := callCount.Add(1)
			auth := r.Header.Get("Authorization")

			if count == 1 && auth == "Bearer "+oldToken {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if count == 2 && auth == "Bearer "+refreshedAccess {
				w.WriteHeader(http.StatusOK)
				if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
					t.Errorf("failed to write response: %v", err)
				}
				return
			}
			t.Errorf("unexpected call %d with auth %q", count, auth)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	return server, &callCount
}

func TestFetchActivity_TokenRefreshOn401(t *testing.T) {
	server, _ := new401ThenSuccessServer(t, "old-token", "new-access-token", "new-refresh-token")
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, 12345)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want %s", string(body), `{"id":12345}`)
	}

	// Verify tokens were written back
	written, ok := tokenStore.WrittenTokens[testOwnerID]
	if !ok {
		t.Fatal("expected tokens to be written back after refresh")
	}
	if written.AccessToken != "new-access-token" {
		t.Errorf("written access token = %s, want new-access-token", written.AccessToken)
	}
	if written.RefreshToken != "new-refresh-token" {
		t.Errorf("written refresh token = %s, want new-refresh-token", written.RefreshToken)
	}

	// The refresh was triggered by a 401 on a still-valid stored token.
	span := spanByName(t, sr, "strava.refresh_token")
	if got := spanAttrString(span, "strava.refresh_reason"); got != refreshReasonReactive401 {
		t.Errorf("strava.refresh_reason = %q, want %q", got, refreshReasonReactive401)
	}
}

func TestFetchActivity_LazyTokenRefresh(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "fresh-token",
				"refresh_token": "new-refresh",
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case "/api/v3/activities/1":
			auth := r.Header.Get("Authorization")
			if auth != "Bearer fresh-token" {
				t.Errorf("expected fresh-token, got %s", auth)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"id":1}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "", RefreshToken: "test-refresh"}, // Empty triggers lazy refresh
		},
	}
	client := newTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, 1)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != `{"id":1}` {
		t.Errorf("body = %s, want %s", string(body), `{"id":1}`)
	}
}

func TestFetchActivity_ServerError(t *testing.T) {
	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte(`{"error":"internal"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, 12345)
	if err == nil {
		t.Fatal("expected error for 500")
	}

	// Should have retried activityRetryAttempts times
	if int(callCount.Load()) != activityRetryAttempts {
		t.Errorf("expected %d attempts, got %d", activityRetryAttempts, callCount.Load())
	}
}

func TestFetchActivity_PreservesExistingRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			// Strava response without refresh_token field
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fresh-token",
				"expires_at":   1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case "/api/v3/activities/1":
			auth := r.Header.Get("Authorization")
			if auth != "Bearer fresh-token" {
				t.Errorf("expected fresh-token, got %s", auth)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"id":1}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "", RefreshToken: "original-refresh"},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, 1)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	// Verify the existing refresh token was preserved when Strava didn't return one
	written, ok := tokenStore.WrittenTokens[testOwnerID]
	if !ok {
		t.Fatal("expected tokens to be written back")
	}
	if written.RefreshToken != "original-refresh" {
		t.Errorf("refresh token = %s, want original-refresh (should be preserved)", written.RefreshToken)
	}
	if written.AccessToken != "fresh-token" {
		t.Errorf("access token = %s, want fresh-token", written.AccessToken)
	}
}

func TestFetchActivity_Repeated401StopsAfterOneRefresh(t *testing.T) {
	var tokenRefreshCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			tokenRefreshCount.Add(1)
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "refreshed-token",
				"refresh_token": "new-refresh",
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			// Always return 401 (simulates deauthorized user)
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "old-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error for persistent 401")
	}
	if !errors.Is(err, ErrStravaAuth) {
		t.Errorf("expected ErrStravaAuth, got %v", err)
	}

	// Should only refresh once, not on every retry attempt
	if tokenRefreshCount.Load() != 1 {
		t.Errorf("expected 1 token refresh, got %d (should stop after first refresh fails to fix 401)", tokenRefreshCount.Load())
	}
}

// TestFetchActivity_RefreshToken401_DoesNotRetry verifies that a 401 from
// Strava's /oauth/token endpoint is not retried inside refreshAndPersist:
// the stored refresh token has been rejected and another attempt with the
// same value would fail identically. Proactive refresh path (expired
// access token) is the easiest way to drive the loop end-to-end.
func TestFetchActivity_RefreshTokenRejected_DoesNotRetry(t *testing.T) {
	var tokenRefreshCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == testTokenPath {
			tokenRefreshCount.Add(1)
			// A genuine refresh-token rejection carries Strava's structured body
			// naming the RefreshToken — the signal that classifies it as rejected
			// rather than a transient/ambiguous 4xx (see isRefreshTokenInvalid).
			w.WriteHeader(http.StatusBadRequest)
			if _, err := w.Write([]byte(`{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`)); err != nil {
				t.Errorf("write response: %v", err)
			}
			return
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "expired", RefreshToken: "revoked", ExpiresAt: pastExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when refresh token is rejected")
	}
	if !errors.Is(err, ErrStravaAuth) {
		t.Errorf("expected ErrStravaAuth, got %v", err)
	}

	if tokenRefreshCount.Load() != 1 {
		t.Errorf("expected 1 token refresh call, got %d (must short-circuit on a confirmed refresh-token rejection)", tokenRefreshCount.Load())
	}

	// strava.refresh_rejected pins the short-circuit branch as filterable
	// in Cloud Trace — regression guard against silent loss of this signal.
	span := spanByName(t, sr, "strava.refresh_token")
	if !spanAttrBool(span, "strava.refresh_rejected") {
		t.Error("strava.refresh_rejected attribute not set on short-circuit branch")
	}
}

// TestFetchActivity_AmbiguousTokenRejectionRetries locks in the deliberate
// classification change behind the forged-deauth fix: a bare 4xx from
// /oauth/token with no structured refresh-token marker is NOT proof the refresh
// token is dead, so the refresh path treats it as transient and retries rather
// than short-circuiting. This is the FetchActivity-side guard against anyone
// re-broadening errRefreshTokenRejected (which would reintroduce the
// application-credential-as-revocation hazard on the deauth path).
func TestFetchActivity_AmbiguousTokenRejectionRetries(t *testing.T) {
	var tokenRefreshCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == testTokenPath {
			tokenRefreshCount.Add(1)
			w.WriteHeader(http.StatusUnauthorized) // bare 401, no structured body
			return
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "expired", RefreshToken: "maybe-live", ExpiresAt: pastExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrStravaAuth) {
		t.Errorf("ambiguous 401 classified as a confirmed refresh rejection: %v", err)
	}
	if tokenRefreshCount.Load() < 2 {
		t.Errorf("token refresh calls = %d, want >1 (an ambiguous rejection is transient and retried)", tokenRefreshCount.Load())
	}
}

// conflictTokenStore simulates the optimistic concurrency conflict scenario.
// First GetTokens returns old tokens; WriteTokensIfUnmodified returns ErrTokenConflict;
// second GetTokens returns the winner's tokens.
type conflictTokenStore struct {
	getCount     atomic.Int32
	oldTokens    *stravatoken.Data
	winnerTokens *stravatoken.Data
}

func (s *conflictTokenStore) GetTokens(_ context.Context, _ int64) (*stravatoken.Data, error) {
	count := s.getCount.Add(1)
	if count == 1 {
		return s.oldTokens, nil
	}
	// After conflict, return the winner's tokens.
	return s.winnerTokens, nil
}

func (s *conflictTokenStore) WriteTokensIfUnmodified(_ context.Context, _ int64, _ *stravatoken.Data, _ time.Time) error {
	return ports.ErrTokenConflict
}

func (s *conflictTokenStore) DeleteTokens(_ context.Context, _ int64) error {
	return nil
}

func TestFetchActivity_TokenRefreshConflict_UsesWinnerTokens(t *testing.T) {
	// Custom server: token refresh returns "loser-token", but after the conflict
	// the client re-reads and gets "winner-access" from the store, which succeeds.
	var activityCallCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token": "loser-token", "refresh_token": "loser-refresh", "expires_at": 1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			count := activityCallCount.Add(1)
			auth := r.Header.Get("Authorization")
			if count == 1 && auth == "Bearer old-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if count == 2 && auth == "Bearer winner-access" {
				w.WriteHeader(http.StatusOK)
				if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
					t.Errorf("failed to write response: %v", err)
				}
				return
			}
			t.Errorf("unexpected activity call %d with auth %q", count, auth)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &conflictTokenStore{
		oldTokens:    &stravatoken.Data{AccessToken: "old-token", RefreshToken: "old-refresh", ExpiresAt: futureExpiry()},
		winnerTokens: &stravatoken.Data{AccessToken: "winner-access", RefreshToken: "winner-refresh"},
	}

	client, sr := newRecordingTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want %s", string(body), `{"id":12345}`)
	}

	// The optimistic-concurrency loss is non-fatal but must be visible
	// in the trace as strava.token_conflict=true.
	span := spanByName(t, sr, "strava.refresh_token")
	if !spanAttrBool(span, "strava.token_conflict") {
		t.Error("strava.token_conflict attribute not set to true on a detected refresh race")
	}
}

func TestAuthError_Error(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		want       string
	}{
		{
			name:       "401 Unauthorized",
			statusCode: 401,
			want:       "strava auth error: HTTP 401",
		},
		{
			name:       "403 Forbidden",
			statusCode: 403,
			want:       "strava auth error: HTTP 403",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &authError{statusCode: tt.statusCode}
			got := e.Error()
			if got != tt.want {
				t.Errorf("authError.Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFetchActivity_TokenStoreError(t *testing.T) {
	// No server needed — the error occurs before any HTTP call.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("no HTTP request expected when token store fails")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	storeErr := errors.New("firestore unavailable")
	tokenStore := &portstest.MockTokenStore{
		GetErr: storeErr,
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when token store returns a generic error")
	}
	if !errors.Is(err, storeErr) {
		t.Errorf("expected wrapped storeErr, got %v", err)
	}
}

func TestFetchActivity_TokenRefreshReturnsNoAccessToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			// Return valid JSON but with empty access_token.
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "",
				"refresh_token": "some-refresh",
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			// Return 401 to trigger the refresh path.
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when token response has empty access_token")
	}
	// Empty-access-token is a Strava-side malformed response (200 with
	// missing field), NOT a permanent rejection of the user's refresh
	// token. Must NOT wrap as ErrStravaAuth — that would (a) exclude
	// the failure from the circuit breaker and (b) misclassify a
	// transient Strava issue as a user-side credential problem.
	if errors.Is(err, ErrStravaAuth) {
		t.Errorf("transient token-response error must not wrap as ErrStravaAuth: %v", err)
	}
	if !errors.Is(err, errRefreshTokenRejected) {
		// Sanity: the underlying error is the "missing access_token"
		// surface, not a refresh-token-rejected sentinel.
		if !strings.Contains(err.Error(), "missing access_token") {
			t.Errorf("expected 'missing access_token' in error, got %v", err)
		}
	}
}

func TestFetchActivity_TokenRefreshInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			// Return 200 with non-JSON body.
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte("this is not json")); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		case testActivityPath:
			// Return 401 to trigger the refresh path.
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when token endpoint returns invalid JSON")
	}
	// Invalid JSON is a Strava-side malformed response, NOT a permanent
	// rejection of the user's refresh token. Must NOT wrap as
	// ErrStravaAuth — see TestFetchActivity_TokenRefreshReturnsNoAccessToken
	// for the full rationale.
	if errors.Is(err, ErrStravaAuth) {
		t.Errorf("transient token-decode error must not wrap as ErrStravaAuth: %v", err)
	}
}

func TestFetchActivity_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Always return 500 to trigger retry with backoff.
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte(`{"error":"internal"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel immediately so the first retry backoff select picks up ctx.Done().
	cancel()

	_, err := client.FetchActivity(ctx, testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when context is canceled")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestFetchActivity_WriteBackFailureReturnsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "new-access-token",
				"refresh_token": "new-refresh-token",
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			// Return 401 to trigger a refresh
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
		WriteErr: errors.New("firestore write failed"),
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, 12345)
	if err == nil {
		t.Fatal("expected error when token write-back fails")
	}
	// Firestore write-back failure is neither a Strava-auth issue
	// (user's tokens are actually fine) nor a permanent refresh-token
	// rejection. Must NOT wrap as ErrStravaAuth — the new contract is
	// that ErrStravaAuth is reserved for errRefreshTokenRejected paths.
	if errors.Is(err, ErrStravaAuth) {
		t.Errorf("write-back failure must not wrap as ErrStravaAuth: %v", err)
	}
	if !strings.Contains(err.Error(), "firestore write failed") {
		t.Errorf("expected underlying write-back error in chain, got %v", err)
	}
}

// TestFetchActivity_TokensDeletedMidRefresh_SurfacesErrTokenNotFound covers
// the deauth/refresh race: GetTokens succeeded, Strava 401 triggered
// reactive refresh, refresh succeeded, but write-back found the doc
// deleted (deauth handler raced in). The write returns
// ports.ErrTokenNotFound; FetchActivity must propagate it so the
// dispatcher handler routes to the orphan ack path instead of looping
// through Strava retries.
func TestFetchActivity_TokensDeletedMidRefresh_SurfacesErrTokenNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "new-access-token",
				"refresh_token": "new-refresh-token",
				"expires_at":    1234567890,
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
		WriteErr: ports.ErrTokenNotFound,
	}
	client := newTestClient(server, tokenStore)

	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error when write-back hits NotFound")
	}
	if !errors.Is(err, ports.ErrTokenNotFound) {
		t.Errorf("expected ErrTokenNotFound to propagate, got %v", err)
	}
	// Must NOT wrap as ErrStravaAuth — that would cause the handler
	// to 500 and Strava to retry instead of routing to the orphan path.
	if errors.Is(err, ErrStravaAuth) {
		t.Errorf("ErrTokenNotFound from write-back must not wrap as ErrStravaAuth: %v", err)
	}
}

func TestProactiveRefreshReason(t *testing.T) {
	// Fixed clock. tokenExpirySkew is 5m (300s); now+skew = 1_000_000_300.
	now := time.Unix(1_000_000_000, 0)
	tests := []struct {
		name      string
		token     *stravatoken.Data
		wantValue string
	}{
		{"empty access token", &stravatoken.Data{AccessToken: "", ExpiresAt: now.Add(time.Hour).Unix()}, refreshReasonEmptyToken},
		{"expired", &stravatoken.Data{AccessToken: "x", ExpiresAt: now.Add(-time.Hour).Unix()}, refreshReasonProactiveExpiry},
		{"within skew window", &stravatoken.Data{AccessToken: "x", ExpiresAt: now.Add(4 * time.Minute).Unix()}, refreshReasonProactiveExpiry},
		{"unset expiry (legacy doc)", &stravatoken.Data{AccessToken: "x", ExpiresAt: 0}, refreshReasonProactiveExpiry},
		{"valid, well beyond skew", &stravatoken.Data{AccessToken: "x", ExpiresAt: now.Add(time.Hour).Unix()}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := proactiveRefreshReason(tt.token, now); got != tt.wantValue {
				t.Errorf("proactiveRefreshReason() = %q, want %q", got, tt.wantValue)
			}
		})
	}
}

// TestFetchActivity_ValidToken_NoRefresh is the core acceptance check:
// a still-valid stored token is used directly with zero refresh calls.
func TestFetchActivity_ValidToken_NoRefresh(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			t.Error("token endpoint must not be called when the stored token is valid")
			w.WriteHeader(http.StatusInternalServerError)
		case testActivityPath:
			if auth := r.Header.Get("Authorization"); auth != "Bearer valid-access" {
				t.Errorf("expected Bearer valid-access, got %q", auth)
			}
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "valid-access", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}
	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want {\"id\":12345}", string(body))
	}
	if _, refreshed := tokenStore.WrittenTokens[testOwnerID]; refreshed {
		t.Error("token was refreshed/written for a valid stored token; expected zero refresh calls")
	}
}

// TestFetchActivity_ProactiveRefreshOnExpiry: an expired stored token is
// refreshed *before* the fetch (no doomed 401 round-trip), and the
// strava.refresh_token span carries strava.refresh_reason=proactive_expiry.
func TestFetchActivity_ProactiveRefreshOnExpiry(t *testing.T) {
	var activityCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fresh-access", "refresh_token": "fresh-refresh", "expires_at": futureExpiry(),
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			activityCalls.Add(1)
			if auth := r.Header.Get("Authorization"); auth != "Bearer fresh-access" {
				t.Errorf("activity called with %q; proactive refresh should prevent any stale-token request", auth)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "stale-access", RefreshToken: "stale-refresh", ExpiresAt: pastExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}
	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want {\"id\":12345}", string(body))
	}
	if n := activityCalls.Load(); n != 1 {
		t.Errorf("activity endpoint called %d times, want 1 (no doomed 401 round-trip)", n)
	}
	written, ok := tokenStore.WrittenTokens[testOwnerID]
	if !ok || written.AccessToken != "fresh-access" {
		t.Errorf("expected proactively refreshed token to be persisted, got %+v (ok=%v)", written, ok)
	}

	span := spanByName(t, sr, "strava.refresh_token")
	if got := spanAttrString(span, "strava.refresh_reason"); got != refreshReasonProactiveExpiry {
		t.Errorf("strava.refresh_reason = %q, want %q", got, refreshReasonProactiveExpiry)
	}
}

// TestFetchActivity_EmptyTokenRefreshReason: the no-stored-token path
// stamps strava.refresh_reason=empty_token.
func TestFetchActivity_EmptyTokenRefreshReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token": "minted-access", "refresh_token": "r", "expires_at": futureExpiry(),
			}); err != nil {
				t.Errorf("failed to encode response: %v", err)
			}
		case testActivityPath:
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "", RefreshToken: "test-refresh"},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}
	span := spanByName(t, sr, "strava.refresh_token")
	if got := spanAttrString(span, "strava.refresh_reason"); got != refreshReasonEmptyToken {
		t.Errorf("strava.refresh_reason = %q, want %q", got, refreshReasonEmptyToken)
	}
}

// TestFetchActivity_RetryEmitsSpanEvents covers Finding 4: transient
// failures emit strava.retry span events and the exhausted attributes.
func TestFetchActivity_RetryEmitsSpanEvents(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte(`{"error":"internal"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "valid-access", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err == nil {
		t.Fatal("expected error after exhausting retries")
	}

	span := spanByName(t, sr, "strava.fetch_activity")

	var retryEvents int
	for _, e := range span.Events() {
		if e.Name != "strava.retry" {
			continue
		}
		retryEvents++
		assertHTTPRetryEvent(t, e, http.StatusInternalServerError)
	}
	// Events fire only between attempts: activityRetryAttempts-1 of them.
	if want := activityRetryAttempts - 1; retryEvents != want {
		t.Errorf("strava.retry event count = %d, want %d", retryEvents, want)
	}
	if got := spanAttrInt(span, "strava.attempts"); got != int64(activityRetryAttempts) {
		t.Errorf("strava.attempts = %d, want %d", got, activityRetryAttempts)
	}
	if !spanAttrBool(span, "strava.exhausted") {
		t.Error("strava.exhausted not set to true on terminal failure")
	}
}

// TestJitterBackoff verifies AWS-style full jitter: sampled durations
// fall in [0, nominal) and the helper handles the zero/negative edge.
// 1000 samples is enough to surface a regression where the cap was
// dropped or the formula collapsed to a constant; the test is timing-
// independent (no sleeps) so it stays fast and deterministic.
func TestJitterBackoff(t *testing.T) {
	t.Run("samples fall in [0, nominal)", func(t *testing.T) {
		const nominal = 1 * time.Second
		for range 1000 {
			got := jitterBackoff(nominal)
			if got < 0 || got >= nominal {
				t.Fatalf("jitterBackoff(%v) = %v, want [0, %v)", nominal, got, nominal)
			}
		}
	})

	t.Run("zero nominal returns zero", func(t *testing.T) {
		if got := jitterBackoff(0); got != 0 {
			t.Errorf("jitterBackoff(0) = %v, want 0", got)
		}
	})

	t.Run("negative nominal returns zero (defensive)", func(t *testing.T) {
		if got := jitterBackoff(-1 * time.Second); got != 0 {
			t.Errorf("jitterBackoff(-1s) = %v, want 0", got)
		}
	})

	t.Run("distribution is not collapsed to a constant", func(t *testing.T) {
		// Catches a regression where the formula loses its random
		// component. Across 100 samples of a 1-second window, the
		// observed range should span a meaningful chunk of [0, 1s).
		const nominal = 1 * time.Second
		var lo, hi time.Duration = nominal, 0
		for range 100 {
			d := jitterBackoff(nominal)
			if d < lo {
				lo = d
			}
			if d > hi {
				hi = d
			}
		}
		// With a uniform sample of n=100 over [0, 1s), the observed
		// max-min should comfortably exceed 500ms. Set the bar at
		// 100ms — generous enough to never flake, tight enough to
		// catch a constant-return regression.
		if spread := hi - lo; spread < 100*time.Millisecond {
			t.Errorf("jitter spread = %v, want >= 100ms (looks collapsed)", spread)
		}
	})
}

// TestCircuitBreaker_TripsAfterConsecutiveFailures verifies the breaker
// opens after the configured threshold of consecutive failing
// operations and short-circuits subsequent calls before any HTTP
// request leaves the process.
func TestCircuitBreaker_TripsAfterConsecutiveFailures(t *testing.T) {
	var serverHits int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		serverHits++
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte(`{"error":"down"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "t", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	// Drive the breaker to OPEN. Each FetchActivity exhausts its
	// internal retry loop (activityRetryAttempts requests) and counts
	// as ONE breaker operation.
	for range breakerFailureThreshold {
		_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
		if err == nil {
			t.Fatal("expected error while server is 500")
		}
	}
	hitsAfterTrip := serverHits

	// Next call should fail-fast with no HTTP request.
	_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected error on fail-fast call after breaker opens")
	}
	if !errors.Is(err, ErrStravaAPI) {
		t.Errorf("breaker-open error not wrapped as ErrStravaAPI: %v", err)
	}
	if serverHits != hitsAfterTrip {
		t.Errorf("server hit during fail-fast: hits before=%d after=%d", hitsAfterTrip, serverHits)
	}
	if state := client.breaker.State(); state != gobreaker.StateOpen {
		t.Errorf("breaker state = %v, want %v", state, gobreaker.StateOpen)
	}
}

// TestCircuitBreaker_BreakerOpenStampsSpan verifies the strava.breaker_open
// span attribute is set on the fail-fast path so Cloud Trace surfaces
// the breaker-open case without log-mining.
func TestCircuitBreaker_BreakerOpenStampsSpan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte(`{"error":"down"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "t", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	for range breakerFailureThreshold {
		if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err == nil {
			t.Fatal("expected error during pre-trip failures")
		}
	}
	// Fail-fast call: this is the one whose span should carry the attr.
	if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err == nil {
		t.Fatal("expected error on fail-fast call")
	}

	// The most recent span is the fail-fast one; earlier spans are the
	// pre-trip failures (no breaker_open attr).
	spans := sr.Ended()
	failFastSpan := spans[len(spans)-1]
	if !spanAttrBool(failFastSpan, "strava.breaker_open") {
		t.Error("strava.breaker_open attribute not set on fail-fast span")
	}
}

// TestCircuitBreaker_404DoesNotCount asserts that per-request errors
// (not Strava-side failures) don't push the breaker toward open. The
// breaker's contract is "trip when the dependency is down" — 404s are
// per-activity, not per-Strava.
func TestCircuitBreaker_404DoesNotCount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		if _, err := w.Write([]byte(`{"error":"not found"}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "t", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	// More attempts than the failure threshold — if 404 counted, the
	// breaker would trip.
	for range breakerFailureThreshold + 2 {
		_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
		if !errors.Is(err, ErrActivityNotFound) {
			t.Fatalf("expected ErrActivityNotFound, got %v", err)
		}
	}
	if state := client.breaker.State(); state != gobreaker.StateClosed {
		t.Errorf("breaker tripped on 404s; state = %v, want Closed", state)
	}
}

// TestIsStravaCallSuccessful enumerates the per-error classification
// that drives the breaker. Catches regressions where a new error
// sentinel is introduced without deciding which side of the breaker
// counts it.
// A request cut short by the caller's budget/deadline (the shared
// handleEventDeadline exhausted upstream — e.g. by a slow token read — before
// the Strava HTTP call) must be breaker-neutral: it is not evidence Strava is
// down. Regression guard for H1 (audit 2026-06-03-dispatcher): before the fix,
// the bare ctx.Err() reached the breaker as a Strava failure and 5 of them
// would trip it. handleEventDeadline == httpClientTimeout == 10s, so budget
// exhaustion is realistic, not "orders of magnitude" away.
func TestFetchActivity_CallerBudgetExhausted_DoesNotTripBreaker(t *testing.T) {
	// The expired context makes http.Client.Do fail before the server is hit,
	// so this handler should never run; the assertions below don't depend on it.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "tok", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	// Far more than breakerFailureThreshold consecutive caller-budget failures.
	for i := 0; i < breakerFailureThreshold+3; i++ {
		// Parent context already past its deadline before the Strava HTTP call.
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		_, err := client.FetchActivity(ctx, testOwnerID, testActivityID)
		cancel()
		if err == nil {
			t.Fatalf("call %d: expected an error from an expired-budget request", i)
		}
		if errors.Is(err, gobreaker.ErrOpenState) {
			t.Fatalf("call %d: breaker opened on caller-budget exhaustion — must stay neutral", i)
		}
	}
	if state := client.breaker.State(); state != gobreaker.StateClosed {
		t.Errorf("breaker = %v, want StateClosed: caller-budget failures must not trip the Strava breaker", state)
	}
}

// A generic/transient Firestore fault on the in-breaker token write-back (M1)
// must be breaker-neutral — it reflects Firestore's health, not Strava's.
// Regression guard for M1 (audit 2026-06-03-dispatcher).
func TestFetchActivity_FirestoreWriteBackFault_DoesNotTripBreaker(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			// Reactive refresh succeeds at Strava...
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "new-access",
				"refresh_token": "new-refresh",
				"expires_at":    futureExpiry(),
			}); err != nil {
				t.Errorf("encode: %v", err)
			}
		case testActivityPath:
			// ...but the activity fetch 401s, forcing the reactive refresh.
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
		// Generic Firestore fault on write-back — NOT a known token sentinel.
		WriteErr: errors.New("firestore: Unavailable"),
	}
	client := newTestClient(server, tokenStore)

	for i := 0; i < breakerFailureThreshold+3; i++ {
		_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
		if err == nil {
			t.Fatalf("call %d: expected an error when the token write-back faults", i)
		}
		if errors.Is(err, gobreaker.ErrOpenState) {
			t.Fatalf("call %d: breaker opened on a Firestore write-back fault — must stay neutral", i)
		}
	}
	if state := client.breaker.State(); state != gobreaker.StateClosed {
		t.Errorf("breaker = %v, want StateClosed: Firestore faults must not trip the Strava breaker", state)
	}
}

// The caller's budget can expire during the response *body read*, not just the
// Do() handshake. That must stay breaker-neutral too. Regression guard for the
// CI review on the H1 fix: server flushes headers (so Do() returns), then hangs
// the body until the caller cancels mid-read.
func TestFetchActivity_BudgetCutDuringBodyRead_IsBreakerNeutral(t *testing.T) {
	bodyPhase := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush() // headers sent → client's Do() returns, body read begins
		}
		select {
		case bodyPhase <- struct{}{}:
		default:
		}
		<-r.Context().Done() // hang the body until the client cancels
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "tok", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		<-bodyPhase
		cancel() // caller's budget ends mid body-read
	}()

	_, err := client.FetchActivity(ctx, testOwnerID, testActivityID)
	if err == nil {
		t.Fatal("expected an error when the body read is cut by the caller")
	}
	if !errors.Is(err, errCallerContextEnded) {
		t.Errorf("body-read budget cut = %v; want errCallerContextEnded", err)
	}
	if !isStravaCallSuccessful(err) {
		t.Errorf("error %v classified as a Strava failure; a caller-budget body-read cut must be neutral", err)
	}
}

func TestIsStravaCallSuccessful(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool // true = NOT counted as Strava failure
	}{
		{"nil success", nil, true},
		{"404 activity not found", ports.ErrActivityNotFound, true},
		{"401 after refresh (ErrStravaAuth)", ErrStravaAuth, true},
		{"refresh token rejected", errRefreshTokenRejected, true},
		{"caller canceled", context.Canceled, true},
		{"http timeout (DeadlineExceeded)", context.DeadlineExceeded, false},
		{"rate limited (429)", &stravaAPIError{statusCode: http.StatusTooManyRequests}, true},
		{"rate limited (typed err)", &rateLimitError{retryAfter: 5 * time.Second}, true},
		// The shape FetchActivity returns when retries exhaust on 429: the
		// rateLimitError wrapped behind ErrStravaAPI. Must still be found via
		// errors.As so a persistent rate limit never trips the breaker.
		{"rate limited (exhausted, wrapped in ErrStravaAPI)", fmt.Errorf("%w: %w", ErrStravaAPI, &rateLimitError{retryAfter: time.Second}), true},
		{"strava 5xx", &stravaAPIError{statusCode: 503}, false},
		{"unknown error counts as failure", errors.New("boom"), false},
		// Caller's request budget/cancellation (parent ctx expired during the
		// HTTP call) — neutral, NOT a Strava failure. This is the shape the
		// Do() sites emit via ctx.Err(); distinct from the bare
		// DeadlineExceeded above (http.Client.Timeout = Strava slow = failure).
		{"caller budget exhausted (sentinel)", errCallerContextEnded, true},
		{"caller budget exhausted (wrapping DeadlineExceeded)", fmt.Errorf("%w: %w", errCallerContextEnded, context.DeadlineExceeded), true},
		// Backoff interrupted by the request budget: classified by the cause,
		// not the bare ctx.Err(). A truncated 429 must stay neutral...
		{"backoff interrupted, 429 cause", fmt.Errorf("strava backoff interrupted: %w (cause: %w)", context.DeadlineExceeded, &rateLimitError{retryAfter: time.Second}), true},
		// ...while a truncated 5xx is still a real Strava failure.
		{"backoff interrupted, 5xx cause", fmt.Errorf("strava backoff interrupted: %w (cause: %w)", context.DeadlineExceeded, &stravaAPIError{statusCode: 503}), false},
		// Generic Firestore fault on the in-breaker token write-back / re-read
		// (M1) — Firestore's health, not Strava's; must not trip the breaker.
		{"token store unavailable (sentinel)", errTokenStoreUnavailable, true},
		{"token store unavailable (write-back shape)", fmt.Errorf("%w: write-back tokens for athlete %d: %w", errTokenStoreUnavailable, int64(1), errors.New("firestore: Unavailable")), true},
		// The conflict-reread shape wrapping a deleted-doc still surfaces
		// ErrTokenNotFound for the handler's orphan path — and stays neutral.
		{"token store unavailable wrapping ErrTokenNotFound", fmt.Errorf("%w: re-read: %w", errTokenStoreUnavailable, ports.ErrTokenNotFound), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isStravaCallSuccessful(tt.err); got != tt.want {
				t.Errorf("isStravaCallSuccessful(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// TestCircuitBreaker_RecoversAfterTimeout verifies the breaker closes
// again once the open-timeout elapses and a probe succeeds — the
// "half-open" recovery path Microsoft's pattern guidance describes.
func TestCircuitBreaker_RecoversAfterTimeout(t *testing.T) {
	var serverDown atomic.Bool
	serverDown.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if serverDown.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			if _, err := w.Write([]byte(`{"error":"down"}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
			return
		}
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "t", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	for range breakerFailureThreshold {
		if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err == nil {
			t.Fatal("expected error while server is down")
		}
	}
	if state := client.breaker.State(); state != gobreaker.StateOpen {
		t.Fatalf("breaker not open after failure threshold; state = %v", state)
	}

	// "Recover" Strava and wait for the open-timeout to elapse. The
	// buffer is 30ms (not 10ms) so the test stays robust under CI
	// scheduling pressure — sleeps shorter than that have flaked in
	// loaded environments.
	serverDown.Store(false)
	time.Sleep(testBreakerTimeout + 30*time.Millisecond)

	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err != nil {
		t.Fatalf("expected success after recovery, got: %v", err)
	}
	if !bytes.Contains(body, []byte("12345")) {
		t.Errorf("unexpected body after recovery: %s", body)
	}
	if state := client.breaker.State(); state != gobreaker.StateClosed {
		t.Errorf("breaker did not close after recovery; state = %v", state)
	}
}

// TestCircuitBreaker_TokenEndpoint5xxCountsAsFailure verifies that a
// proactive-refresh failure caused by Strava's /oauth/token endpoint
// returning 5xx is NOT swallowed by the ErrStravaAuth wrap and DOES
// drive the breaker toward open. Regression guard for the bug gemini
// flagged: wrapping transient token-refresh failures as ErrStravaAuth
// hides the failure from the breaker (excluded by isStravaCallSuccessful)
// and risks misclassifying a Strava outage as a per-user auth issue.
func TestCircuitBreaker_TokenEndpoint5xxCountsAsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == testTokenPath {
			w.WriteHeader(http.StatusServiceUnavailable)
			if _, err := w.Write([]byte(`{"error":"oauth down"}`)); err != nil {
				t.Errorf("failed to write response: %v", err)
			}
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// pastExpiry triggers proactive refresh on every FetchActivity,
	// so each call hits the (failing) token endpoint.
	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old", RefreshToken: "r", ExpiresAt: pastExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	for range breakerFailureThreshold {
		_, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
		if err == nil {
			t.Fatal("expected error while token endpoint is 5xx")
		}
		if errors.Is(err, ErrStravaAuth) {
			t.Errorf("token-endpoint 5xx must not wrap as ErrStravaAuth: %v", err)
		}
	}
	if state := client.breaker.State(); state != gobreaker.StateOpen {
		t.Errorf("breaker did not open from token-endpoint 5xx failures; state = %v", state)
	}
}

func TestParseRetryAfter(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want time.Duration
	}{
		{"empty", "", 0},
		{"zero", "0", 0},
		{"positive delta-seconds", "5", 5 * time.Second},
		{"negative", "-1", 0},
		{"non-numeric", "not-a-number", 0},
		// HTTP-date form is spec-legal but unsupported (Strava emits
		// delta-seconds); must fall back to 0 rather than misparse.
		{"http-date", "Wed, 21 Oct 2026 07:28:00 GMT", 0},
		// Values above the cap are clamped (can't honor a >60s sleep in a 60s
		// request budget anyway).
		{"above cap clamped", "120", maxRetryAfter},
		// Pathological value: clamped before the multiply, so no int64 overflow.
		{"huge value clamped (overflow-safe)", "99999999999", maxRetryAfter},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseRetryAfter(tc.in); got != tc.want {
				t.Errorf("parseRetryAfter(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestFetchActivity_429HonorsRetryAfter proves the retry loop floors its
// backoff at Strava's Retry-After. Retry-After is 2s; the static backoff on
// the first attempt is capped at activityRetryBackoff (1s) and jittered into
// [0,1s), so an elapsed of ≥1.5s can only come from the Retry-After floor.
func TestFetchActivity_429HonorsRetryAfter(t *testing.T) {
	expectedBody := `{"id":12345,"name":"Morning Run"}`
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testActivityPath {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(expectedBody)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, tokenStore)

	start := time.Now()
	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}
	if string(body) != expectedBody {
		t.Errorf("body = %s, want %s", string(body), expectedBody)
	}
	if elapsed < 1500*time.Millisecond {
		t.Errorf("elapsed = %v, want ≥ 1.5s — Retry-After (2s) was not honored "+
			"(static backoff alone is capped under 1s on the first attempt)", elapsed)
	}
}

// TestFetchActivity_429StampsSpanAttribute asserts the rate-limit span
// attributes land on the fetch span so 429s are filterable in Cloud Trace.
func TestFetchActivity_429StampsSpanAttribute(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testActivityPath {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "r", ExpiresAt: futureExpiry()},
		},
	}
	client, sr := newRecordingTestClient(server, tokenStore)

	if _, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID); err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	span := spanByName(t, sr, "strava.fetch_activity")
	if !spanAttrBool(span, "strava.rate_limited") {
		t.Error("strava.rate_limited not set to true on a 429 fetch")
	}
	if got := spanAttrInt(span, "strava.retry_after_ms"); got <= 0 {
		t.Errorf("strava.retry_after_ms = %d, want > 0", got)
	}
}

// flakyWriteTokenStore fails the first N write attempts with a generic
// (non-sentinel) error, then succeeds — the transient-Firestore-fault shape.
type flakyWriteTokenStore struct {
	tokens     *stravatoken.Data
	failWrites int32
	writeCount atomic.Int32
}

func (s *flakyWriteTokenStore) GetTokens(_ context.Context, _ int64) (*stravatoken.Data, error) {
	return s.tokens, nil
}

func (s *flakyWriteTokenStore) WriteTokensIfUnmodified(_ context.Context, _ int64, _ *stravatoken.Data, _ time.Time) error {
	if s.writeCount.Add(1) <= s.failWrites {
		return errors.New("firestore unavailable")
	}
	return nil
}

func (s *flakyWriteTokenStore) DeleteTokens(_ context.Context, _ int64) error { return nil }

// TestFetchActivity_WriteBackRetriedAfterTransientFault pins the retry added for
// audit 2026-07-22-dispatcher M1. A refresh that succeeds upstream but whose
// persist hits one transient Firestore fault must still land the tokens, because
// the alternative is discarding a refresh token Strava may have just rotated —
// which bricks the grant. Before the retry, this scenario returned an error and
// dropped the new tokens on the floor.
func TestFetchActivity_WriteBackRetriedAfterTransientFault(t *testing.T) {
	var activityServed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case testTokenPath:
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "new-access-token",
				"refresh_token": "new-refresh-token",
				"expires_at":    futureExpiry(),
			}); err != nil {
				t.Errorf("failed to encode token response: %v", err)
			}
		case testActivityPath:
			// 401 on the first call forces the reactive refresh; the retried
			// call after a successful refresh succeeds.
			if !activityServed.Swap(true) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]any{"id": 12345, "name": "Ride"}); err != nil {
				t.Errorf("failed to encode activity response: %v", err)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	store := &flakyWriteTokenStore{
		tokens:     &stravatoken.Data{AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		failWrites: 1,
	}
	client := newTestClient(server, store)

	if _, err := client.FetchActivity(context.Background(), testOwnerID, 12345); err != nil {
		t.Fatalf("expected the retried write-back to succeed, got %v", err)
	}
	if got := store.writeCount.Load(); got != 2 {
		t.Errorf("write attempts = %d, want 2 (one transient failure then a success)", got)
	}
}

// TestRefreshAndPersist_ConcurrentRefreshesCollapseToOneCall pins the
// singleflight serialization added for audit 2026-07-29-dispatcher M1.
//
// The optimistic write-back guards the write, not the call: without this, two
// webhooks for one athlete could both POST the same refresh_token to Strava
// before either write landed. Strava rotates refresh tokens, so replaying a
// just-consumed one risks the provider treating it as theft and revoking the
// grant. The guarantee under test is therefore about the *outbound call count*,
// not about which caller wins.
func TestRefreshAndPersist_ConcurrentRefreshesCollapseToOneCall(t *testing.T) {
	var tokenCalls atomic.Int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testTokenPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		tokenCalls.Add(1)
		// Hold the first call open long enough that a second caller is
		// guaranteed to arrive while it is in flight — otherwise the two could
		// serialize naturally and the test would pass without singleflight.
		<-release
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "new-access-token",
			"refresh_token": "new-refresh-token",
			"expires_at":    futureExpiry(),
		}); err != nil {
			t.Errorf("failed to encode token response: %v", err)
		}
	}))
	defer server.Close()

	store := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.Data{
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()},
		},
	}
	client := newTestClient(server, store)
	tokens := &stravatoken.Data{AccessToken: "old-token", RefreshToken: "test-refresh", ExpiresAt: futureExpiry()}

	const callers = 2
	var wg sync.WaitGroup
	errs := make([]error, callers)
	for i := range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = client.refreshAndPersist(context.Background(), testOwnerID, tokens, refreshReasonReactive401)
		}()
	}

	// Give both goroutines time to reach the singleflight gate before the
	// server responds.
	time.Sleep(100 * time.Millisecond)
	close(release)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("caller %d: unexpected error: %v", i, err)
		}
	}
	if got := tokenCalls.Load(); got != 1 {
		t.Errorf("outbound /oauth/token calls = %d, want 1 — concurrent refreshes must collapse", got)
	}
}

// VerifyGrant backs the dispatcher's forged-deauth defense. GrantRevoked is a
// destructive authorization decision, so these tests exercise both positive
// proof and the ambiguous cases that must remain GrantUnknown.

func TestVerifyGrant_RevokedGrantReturnsRevoked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testTokenPath {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		if _, err := w.Write([]byte(`{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`)); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{Tokens: map[int64]*stravatoken.Data{
		testOwnerID: {AccessToken: "expired", RefreshToken: "revoked", ExpiresAt: pastExpiry()},
	}}
	client := newTestClient(server, tokenStore)

	status, err := client.VerifyGrant(context.Background(), testOwnerID)
	if err != nil {
		t.Fatalf("VerifyGrant() error = %v, want nil", err)
	}
	if status != ports.GrantRevoked {
		t.Errorf("status = %s, want revoked", status)
	}
}

func TestVerifyGrant_LiveAccessTokenIsActiveWithoutRotation(t *testing.T) {
	var tokenCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/athlete":
			if got := r.Header.Get("Authorization"); got != "Bearer live-access" {
				t.Errorf("Authorization = %q, want live token", got)
			}
			if err := json.NewEncoder(w).Encode(map[string]any{"id": testOwnerID}); err != nil {
				t.Errorf("encode response: %v", err)
			}
		case testTokenPath:
			tokenCalls.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{Tokens: map[int64]*stravatoken.Data{
		testOwnerID: {AccessToken: "live-access", RefreshToken: "live-refresh", ExpiresAt: futureExpiry()},
	}}
	client := newTestClient(server, tokenStore)

	status, err := client.VerifyGrant(context.Background(), testOwnerID)
	if err != nil {
		t.Fatalf("VerifyGrant() error = %v, want nil", err)
	}
	if status != ports.GrantActive {
		t.Errorf("status = %s, want active", status)
	}
	if got := tokenCalls.Load(); got != 0 {
		t.Errorf("token refresh calls = %d, want 0; forged events must not rotate live tokens", got)
	}
	if len(tokenStore.WrittenTokens) != 0 {
		t.Errorf("unexpected token write: %+v", tokenStore.WrittenTokens)
	}
}

func TestVerifyGrant_ExpiredActiveGrantRefreshes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testTokenPath {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err := json.NewEncoder(w).Encode(map[string]any{
			"access_token": "rotated-access", "refresh_token": "rotated-refresh", "expires_at": futureExpiry(),
		}); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{Tokens: map[int64]*stravatoken.Data{
		testOwnerID: {AccessToken: "expired", RefreshToken: "live-refresh", ExpiresAt: pastExpiry()},
	}}
	client := newTestClient(server, tokenStore)

	status, err := client.VerifyGrant(context.Background(), testOwnerID)
	if err != nil || status != ports.GrantActive {
		t.Fatalf("VerifyGrant() = (%s, %v), want (active, nil)", status, err)
	}
	if written := tokenStore.WrittenTokens[testOwnerID]; written == nil || written.RefreshToken != "rotated-refresh" {
		t.Errorf("expected rotated token persisted, got %+v", written)
	}
}

func TestVerifyGrant_ApplicationCredentialRejectionIsUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		if _, err := w.Write([]byte(`{"message":"Bad Request","errors":[{"resource":"Application","field":"client_id","code":"invalid"}]}`)); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{Tokens: map[int64]*stravatoken.Data{
		testOwnerID: {AccessToken: "expired", RefreshToken: "still-possibly-live", ExpiresAt: pastExpiry()},
	}}
	client := newTestClient(server, tokenStore)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	status, err := client.VerifyGrant(ctx, testOwnerID)
	if err == nil {
		t.Fatal("err = nil, want ambiguous application-credential error")
	}
	if status != ports.GrantUnknown {
		t.Errorf("status = %s, want unknown; app credentials cannot prove athlete revocation", status)
	}
	if errors.Is(err, errRefreshTokenRejected) {
		t.Errorf("application rejection classified as refresh-token rejection: %v", err)
	}
}

type staleGrantTokenStore struct {
	mu          sync.Mutex
	stale       *stravatoken.Data
	fresh       *stravatoken.Data
	invalidated bool
}

func (s *staleGrantTokenStore) GetTokens(context.Context, int64) (*stravatoken.Data, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.invalidated {
		return s.fresh, nil
	}
	return s.stale, nil
}

func (s *staleGrantTokenStore) WriteTokensIfUnmodified(context.Context, int64, *stravatoken.Data, time.Time) error {
	return errors.New("unexpected token write")
}

func (s *staleGrantTokenStore) DeleteTokens(context.Context, int64) error { return nil }

func (s *staleGrantTokenStore) Invalidate(int64) {
	s.mu.Lock()
	s.invalidated = true
	s.mu.Unlock()
}

func TestVerifyGrant_StaleRejectedCacheRereadsAuthoritativeToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/athlete":
			switch r.Header.Get("Authorization") {
			case "Bearer stale-access":
				w.WriteHeader(http.StatusUnauthorized)
			case "Bearer fresh-access":
				if err := json.NewEncoder(w).Encode(map[string]any{"id": testOwnerID}); err != nil {
					t.Errorf("encode response: %v", err)
				}
			default:
				t.Errorf("unexpected Authorization header %q", r.Header.Get("Authorization"))
				w.WriteHeader(http.StatusUnauthorized)
			}
		case testTokenPath:
			if err := r.ParseForm(); err != nil {
				t.Errorf("ParseForm: %v", err)
			}
			if got := r.Form.Get(paramRefreshToken); got != "stale-refresh" {
				t.Errorf("refresh_token = %q, want stale-refresh", got)
			}
			w.WriteHeader(http.StatusBadRequest)
			if _, err := w.Write([]byte(`{"errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`)); err != nil {
				t.Errorf("write response: %v", err)
			}
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	store := &staleGrantTokenStore{
		stale: &stravatoken.Data{AccessToken: "stale-access", RefreshToken: "stale-refresh", ExpiresAt: futureExpiry()},
		fresh: &stravatoken.Data{AccessToken: "fresh-access", RefreshToken: "fresh-refresh", ExpiresAt: futureExpiry()},
	}
	client := newTestClient(server, store)

	status, err := client.VerifyGrant(context.Background(), testOwnerID)
	if err != nil || status != ports.GrantActive {
		t.Fatalf("VerifyGrant() = (%s, %v), want (active, nil)", status, err)
	}
	store.mu.Lock()
	invalidated := store.invalidated
	store.mu.Unlock()
	if !invalidated {
		t.Error("rejected cached token did not invalidate before authoritative re-read")
	}
}

func TestVerifyGrant_NoTokensReturnsUnknownAndErrTokenNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("no Strava call expected with no stored tokens, got %s %s", r.Method, r.URL.Path)
	}))
	defer server.Close()

	client := newTestClient(server, &portstest.MockTokenStore{})
	status, err := client.VerifyGrant(context.Background(), testOwnerID)
	if !errors.Is(err, ports.ErrTokenNotFound) {
		t.Fatalf("err = %v, want ErrTokenNotFound", err)
	}
	if status != ports.GrantUnknown {
		t.Errorf("status = %s, want unknown", status)
	}
}

func TestVerifyGrant_TransientErrorIsUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{Tokens: map[int64]*stravatoken.Data{
		testOwnerID: {AccessToken: "expired", RefreshToken: "live-refresh", ExpiresAt: pastExpiry()},
	}}
	client := newTestClient(server, tokenStore)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	status, err := client.VerifyGrant(ctx, testOwnerID)
	if err == nil {
		t.Fatal("err = nil, want transient error")
	}
	if status != ports.GrantUnknown {
		t.Errorf("status = %s, want unknown", status)
	}
}
