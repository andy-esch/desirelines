package strava

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/otel"
)

func newTestOAuthClient(serverURL string) *OAuthClient {
	noopHist, _ := otel.NoopMeter().Float64Histogram("test") //nolint:errcheck // no-op meter never fails
	client := NewOAuthClient("test-client-id", "test-client-secret", slog.New(slog.NewTextHandler(io.Discard, nil)), http.DefaultClient, noopHist)
	client.tokenURL = serverURL
	return client
}

// writeJSON writes a JSON string to the response, failing the test on error.
func writeJSON(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if _, err := fmt.Fprint(w, body); err != nil {
		t.Fatalf("failed to write response body: %v", err)
	}
}

func TestExchangeCode_HappyPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			t.Errorf("Content-Type = %q, want application/x-www-form-urlencoded", ct)
		}

		// Limit request body size to prevent memory exhaustion (G120)
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if parseErr := r.ParseForm(); parseErr != nil {
			t.Fatalf("failed to parse form: %v", parseErr)
		}
		checks := map[string]string{
			"client_id":     "test-client-id",
			"client_secret": "test-client-secret",
			"code":          "auth-code-123",
			"grant_type":    "authorization_code",
		}
		for key, want := range checks {
			if got := r.FormValue(key); got != want {
				t.Errorf("form %s = %q, want %q", key, got, want)
			}
		}

		writeJSON(t, w, `{
			"access_token": "at-123",
			"refresh_token": "rt-456",
			"expires_at": 1700000000,
			"expires_in": 21600,
			"athlete": {
				"id": 99999,
				"firstname": "Jane",
				"lastname": "Doe",
				"profile": "https://strava.com/avatar.jpg"
			}
		}`)
	}))
	defer server.Close()

	client := newTestOAuthClient(server.URL)
	resp, err := client.ExchangeCode(context.Background(), "auth-code-123")
	if err != nil {
		t.Fatalf("ExchangeCode() error = %v", err)
	}

	if resp.AccessToken != "at-123" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "at-123")
	}
	if resp.RefreshToken != "rt-456" {
		t.Errorf("RefreshToken = %q, want %q", resp.RefreshToken, "rt-456")
	}
	if resp.ExpiresAt != 1700000000 {
		t.Errorf("ExpiresAt = %d, want %d", resp.ExpiresAt, 1700000000)
	}
	if resp.Athlete.ID != 99999 {
		t.Errorf("Athlete.ID = %d, want %d", resp.Athlete.ID, 99999)
	}
	if resp.Athlete.FirstName != "Jane" {
		t.Errorf("Athlete.FirstName = %q, want %q", resp.Athlete.FirstName, "Jane")
	}
}

func TestExchangeCode_ErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(t, w, `{"message":"Bad Request"}`)
	}))
	defer server.Close()

	client := newTestOAuthClient(server.URL)
	_, err := client.ExchangeCode(context.Background(), "bad-code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for 400 status, got nil")
	}
}

func TestExchangeCode_MalformedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{not valid json`)
	}))
	defer server.Close()

	client := newTestOAuthClient(server.URL)
	_, err := client.ExchangeCode(context.Background(), "code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for malformed JSON, got nil")
	}
}

func TestExchangeCode_MissingAccessToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"refresh_token":"rt","expires_at":123,"athlete":{"id":1}}`)
	}))
	defer server.Close()

	client := newTestOAuthClient(server.URL)
	_, err := client.ExchangeCode(context.Background(), "code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for missing access_token, got nil")
	}
}

func TestExchangeCode_MissingRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"access_token":"at","expires_at":123,"athlete":{"id":1}}`)
	}))
	defer server.Close()

	client := newTestOAuthClient(server.URL)
	_, err := client.ExchangeCode(context.Background(), "code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for missing refresh_token, got nil")
	}
}

func TestExchangeCode_ServerUnreachable(t *testing.T) {
	client := newTestOAuthClient("http://127.0.0.1:1") // port 1 — nothing listening
	_, err := client.ExchangeCode(context.Background(), "code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for unreachable server, got nil")
	}
}

func TestExchangeCode_ContextCanceled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"access_token":"at","athlete":{"id":1}}`)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before making the request

	client := newTestOAuthClient(server.URL)
	_, err := client.ExchangeCode(ctx, "code")
	if err == nil {
		t.Fatal("ExchangeCode() expected error for canceled context, got nil")
	}
}
