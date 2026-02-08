package strava

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// newTestClient creates a Client pointing at the given test server.
func newTestClient(server *httptest.Server) *Client {
	return &Client{
		httpClient:   server.Client(),
		clientID:     "test-id",
		clientSecret: "test-secret",
		refreshToken: "test-refresh",
		accessToken:  "test-access-token",
		tokenURL:     server.URL + "/oauth/token",
		apiBase:      server.URL + "/api/v3",
		logger:       gcplog.NewNoOpLogger(),
	}
}

func TestFetchActivity_Success(t *testing.T) {
	expectedBody := `{"id":12345,"name":"Morning Run","distance":5000}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v3/activities/12345" {
			auth := r.Header.Get("Authorization")
			if auth != "Bearer test-access-token" {
				t.Errorf("unexpected Authorization header: %s", auth)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(expectedBody))
			return
		}
		t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := newTestClient(server)

	body, err := client.FetchActivity(context.Background(), 12345)
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
		_, _ = w.Write([]byte(`{"message":"Record Not Found"}`))
	}))
	defer server.Close()

	client := newTestClient(server)

	_, err := client.FetchActivity(context.Background(), 99999)
	if err == nil {
		t.Fatal("expected error for 404")
	}
	if err != ErrActivityNotFound {
		t.Errorf("expected ErrActivityNotFound, got %v", err)
	}
}

func TestFetchActivity_TokenRefreshOn401(t *testing.T) {
	var callCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"access_token": "new-access-token",
			})
		case "/api/v3/activities/12345":
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
				_, _ = w.Write([]byte(`{"id":12345}`))
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

	client := newTestClient(server)
	client.accessToken = "old-token"

	body, err := client.FetchActivity(context.Background(), 12345)
	if err != nil {
		t.Fatalf("FetchActivity() error = %v", err)
	}

	if string(body) != `{"id":12345}` {
		t.Errorf("body = %s, want %s", string(body), `{"id":12345}`)
	}
}

func TestFetchActivity_LazyTokenRefresh(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"access_token": "fresh-token",
			})
		case "/api/v3/activities/1":
			auth := r.Header.Get("Authorization")
			if auth != "Bearer fresh-token" {
				t.Errorf("expected fresh-token, got %s", auth)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":1}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client := newTestClient(server)
	client.accessToken = "" // Empty triggers lazy refresh

	body, err := client.FetchActivity(context.Background(), 1)
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
		_, _ = w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	client := newTestClient(server)

	_, err := client.FetchActivity(context.Background(), 12345)
	if err == nil {
		t.Fatal("expected error for 500")
	}

	// Should have retried activityRetryAttempts times
	if int(callCount.Load()) != activityRetryAttempts {
		t.Errorf("expected %d attempts, got %d", activityRetryAttempts, callCount.Load())
	}
}
