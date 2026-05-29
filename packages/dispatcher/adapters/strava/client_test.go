package strava

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
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

// newTestClient creates a Client pointing at the given test server with a token store.
func newTestClient(server *httptest.Server, tokenStore ports.TokenStore) *Client {
	noopProviders := otel.NoopProviders()
	noopHist, _ := noopProviders.Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
	return &Client{
		httpClient:   server.Client(),
		clientID:     "test-id",
		clientSecret: "test-secret",
		tokenStore:   tokenStore,
		tokenURL:     server.URL + testTokenPath,
		apiBase:      server.URL + "/api/v3",
		logger:       gcplog.NewNoOpLogger(),
		histogram:    noopHist,
		tracer:       noopProviders.Tracer,
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
func TestFetchActivity_RefreshToken401_DoesNotRetry(t *testing.T) {
	var tokenRefreshCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == testTokenPath {
			tokenRefreshCount.Add(1)
			w.WriteHeader(http.StatusUnauthorized)
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
		t.Errorf("expected 1 token refresh call, got %d (must short-circuit on 401 from /oauth/token)", tokenRefreshCount.Load())
	}

	// strava.refresh_rejected pins the short-circuit branch as filterable
	// in Cloud Trace — regression guard against silent loss of this signal.
	span := spanByName(t, sr, "strava.refresh_token")
	if !spanAttrBool(span, "strava.refresh_rejected") {
		t.Error("strava.refresh_rejected attribute not set on short-circuit branch")
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
	if !errors.Is(err, ErrStravaAuth) {
		t.Errorf("expected ErrStravaAuth, got %v", err)
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
	if !errors.Is(err, ErrStravaAuth) {
		t.Errorf("expected ErrStravaAuth, got %v", err)
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
	if !errors.Is(err, ErrStravaAuth) {
		t.Errorf("expected ErrStravaAuth, got %v", err)
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
