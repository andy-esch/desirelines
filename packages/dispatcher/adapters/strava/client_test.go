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
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

const (
	testOwnerID         int64 = 67890
	testActivityPath          = "/api/v3/activities/12345"
	testTokenPath             = "/oauth/token" //nolint:gosec // URL path, not credential
	testActivityID      int64 = 12345
	testSmallActivityID int64 = 1
)

// newTestClient creates a Client pointing at the given test server with a token store.
func newTestClient(server *httptest.Server, tokenStore ports.TokenStore) *Client {
	return &Client{
		httpClient:   server.Client(),
		clientID:     "test-id",
		clientSecret: "test-secret",
		tokenStore:   tokenStore,
		tokenURL:     server.URL + testTokenPath,
		apiBase:      server.URL + "/api/v3",
		logger:       gcplog.NewNoOpLogger(),
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
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh"},
		},
	}
	client := newTestClient(server, tokenStore)

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
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "old-token", RefreshToken: "old-refresh"},
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
		oldTokens:    &stravatoken.Data{AccessToken: "old-token", RefreshToken: "old-refresh"},
		winnerTokens: &stravatoken.Data{AccessToken: "winner-access", RefreshToken: "winner-refresh"},
	}

	client := newTestClient(server, tokenStore)

	body, err := client.FetchActivity(context.Background(), testOwnerID, testActivityID)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want %s", string(body), `{"id":12345}`)
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
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "test-access-token", RefreshToken: "test-refresh"},
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
			testOwnerID: {AccessToken: "old-token", RefreshToken: "test-refresh"},
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
