package strava

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

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

// newTestClient creates a Client pointing at the given test server with a mock token store.
func newTestClient(server *httptest.Server, tokenStore *portstest.MockTokenStore) *Client {
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
		Tokens: map[int64]*stravatoken.StravaTokenData{
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
		Tokens: map[int64]*stravatoken.StravaTokenData{
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

func TestFetchActivity_TokenRefreshOn401(t *testing.T) {
	var callCount atomic.Int32

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
			count := callCount.Add(1)
			auth := r.Header.Get("Authorization")

			if count == 1 && auth == "Bearer old-token" {
				// First call with old token: return 401
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if count == 2 && auth == "Bearer new-access-token" {
				// Retry with new token: success
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
	defer server.Close()

	tokenStore := &portstest.MockTokenStore{
		Tokens: map[int64]*stravatoken.StravaTokenData{
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
		Tokens: map[int64]*stravatoken.StravaTokenData{
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
		Tokens: map[int64]*stravatoken.StravaTokenData{
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
		Tokens: map[int64]*stravatoken.StravaTokenData{
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
