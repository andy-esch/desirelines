package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
)

// mockAuthMiddleware implements AuthMiddleware for testing
type mockAuthMiddleware struct {
	called      bool
	blockAccess bool
}

func (m *mockAuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.called = true
		if m.blockAccess {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Test RespondJSON
func TestRespondJSON(t *testing.T) {
	logger := slog.Default()

	t.Run("writes correct status and content type", func(t *testing.T) {
		w := httptest.NewRecorder()

		data := map[string]string{"message": "hello"}
		RespondJSON(w, http.StatusOK, data, logger)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}

		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}
	})

	t.Run("encodes struct to JSON", func(t *testing.T) {
		w := httptest.NewRecorder()

		type TestData struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		}
		data := TestData{Name: "test", Count: 42}
		RespondJSON(w, http.StatusOK, data, logger)

		var result TestData
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if result.Name != "test" || result.Count != 42 {
			t.Errorf("response = %+v, want %+v", result, data)
		}
	})

	t.Run("handles various status codes", func(t *testing.T) {
		codes := []int{
			http.StatusOK,
			http.StatusCreated,
			http.StatusAccepted,
			http.StatusNoContent,
		}

		for _, code := range codes {
			w := httptest.NewRecorder()

			RespondJSON(w, code, nil, logger)

			if w.Code != code {
				t.Errorf("status for %d = %d", code, w.Code)
			}
		}
	})
}

// Test RespondRawJSON
func TestRespondRawJSON(t *testing.T) {
	logger := slog.Default()

	t.Run("writes raw JSON bytes", func(t *testing.T) {
		w := httptest.NewRecorder()

		rawJSON := []byte(`{"raw":"data","number":123}`)
		RespondRawJSON(w, http.StatusOK, rawJSON, logger)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}

		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}

		if w.Body.String() != string(rawJSON) {
			t.Errorf("body = %q, want %q", w.Body.String(), string(rawJSON))
		}
	})

	t.Run("does not double-encode JSON", func(t *testing.T) {
		w := httptest.NewRecorder()

		// Pre-marshaled JSON
		rawJSON := []byte(`{"key":"value"}`)
		RespondRawJSON(w, http.StatusOK, rawJSON, logger)

		// Should be exactly the same, not escaped/quoted
		if w.Body.String() != `{"key":"value"}` {
			t.Errorf("body = %q, should not be double-encoded", w.Body.String())
		}
	})
}

// Test CORSMiddleware
func TestCORSMiddleware(t *testing.T) {
	logger := slog.Default()

	t.Run("handles OPTIONS preflight", func(t *testing.T) {
		c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("cors.NewHandler: %v", err)
		}
		middleware := CORSMiddleware(c)

		nextCalled := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
		})

		req := corsRequest(http.MethodOptions, "/test")
		w := httptest.NewRecorder()

		middleware(next).ServeHTTP(w, req)

		if nextCalled {
			t.Error("next handler should not be called for OPTIONS request")
		}
		if w.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
		}
	})

	t.Run("passes through non-OPTIONS requests", func(t *testing.T) {
		c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("cors.NewHandler: %v", err)
		}
		middleware := CORSMiddleware(c)

		nextCalled := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
			w.WriteHeader(http.StatusOK)
		})

		req := corsRequest(http.MethodGet, "/test")
		w := httptest.NewRecorder()

		middleware(next).ServeHTTP(w, req)

		if !nextCalled {
			t.Error("next handler should be called for GET request")
		}
	})

	t.Run("sets CORS headers before handler", func(t *testing.T) {
		c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("cors.NewHandler: %v", err)
		}
		middleware := CORSMiddleware(c)

		var corsHeaderSet bool
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check if CORS header was set before this handler ran
			corsHeaderSet = w.Header().Get("Access-Control-Allow-Origin") != ""
		})

		req := corsRequest(http.MethodGet, "/test")
		w := httptest.NewRecorder()

		middleware(next).ServeHTTP(w, req)

		if !corsHeaderSet {
			t.Error("CORS headers should be set before next handler runs")
		}
	})
}

// corsRequest builds a request with the test Origin header preset, matching the
// allowed origin used throughout these tests.
func corsRequest(method, path string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Origin", "https://example.com")
	return req
}

// noopAuthRoutes returns AuthenticatedRoutes with no-op handlers for testing.
func noopAuthRoutes() AuthenticatedRoutes {
	return AuthenticatedRoutes{
		GetMetadata:     func(w http.ResponseWriter, r *http.Request) {},
		GetMetrics:      func(w http.ResponseWriter, r *http.Request) {},
		GetSource:       func(w http.ResponseWriter, r *http.Request) {},
		GetMapTile:      func(w http.ResponseWriter, r *http.Request) {},
		GetMapRegions:   func(w http.ResponseWriter, r *http.Request) {},
		ListActivities:  func(w http.ResponseWriter, r *http.Request) {},
		GetActivityByID: func(w http.ResponseWriter, r *http.Request) {},
	}
}

// newTestRouter creates a router with no-op handlers for testing
func newTestRouter(c *cors.Handler, auth *mockAuthMiddleware, logger *slog.Logger) chi.Router {
	return NewRouter(
		RouterConfig{CORSHandler: c, AuthMiddleware: auth},
		PublicRoutes{
			Health:      func(w http.ResponseWriter, r *http.Request) {},
			Ready:       func(w http.ResponseWriter, r *http.Request) {},
			SportConfig: func(w http.ResponseWriter, r *http.Request) {},
		},
		noopAuthRoutes(),
		logger,
	)
}

// Test NewRouter route registration
func TestNewRouter_RouteRegistration(t *testing.T) {
	logger := slog.Default()

	tests := []struct {
		name         string
		method       string
		path         string
		wantAuthCall bool
	}{
		{"health endpoint (public)", http.MethodGet, "/health", false},
		{"ready endpoint (public)", http.MethodGet, "/ready", false},
		{"sports config (public)", http.MethodGet, "/v1/sports/config", false},
		{"metadata (auth)", http.MethodGet, "/v1/activities/2024/metadata", true},
		{"metrics (auth)", http.MethodGet, "/v1/activities/2024/metrics", true},
		{"source (auth)", http.MethodGet, "/v1/activities/2024/source", true},
		{"list activities (auth)", http.MethodGet, "/v1/activities", true},
		{"get activity by ID (auth)", http.MethodGet, "/v1/activities/123", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
			if err != nil {
				t.Fatalf("cors.NewHandler: %v", err)
			}
			auth := &mockAuthMiddleware{}
			router := newTestRouter(c, auth, logger)

			req := corsRequest(tt.method, tt.path)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if auth.called != tt.wantAuthCall {
				t.Errorf("auth.called = %v, want %v", auth.called, tt.wantAuthCall)
			}
		})
	}
}

// Test auth middleware blocks unauthorized
func TestNewRouter_AuthBlocking(t *testing.T) {
	logger := slog.Default()
	c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
	if err != nil {
		t.Fatalf("cors.NewHandler: %v", err)
	}
	auth := &mockAuthMiddleware{blockAccess: true}

	handlerCalled := false
	authRoutes := noopAuthRoutes()
	authRoutes.GetMetadata = func(w http.ResponseWriter, r *http.Request) { handlerCalled = true }
	router := NewRouter(
		RouterConfig{CORSHandler: c, AuthMiddleware: auth},
		PublicRoutes{
			Health:      func(w http.ResponseWriter, r *http.Request) {},
			Ready:       func(w http.ResponseWriter, r *http.Request) {},
			SportConfig: func(w http.ResponseWriter, r *http.Request) {},
		},
		authRoutes,
		logger,
	)

	req := corsRequest(http.MethodGet, "/v1/activities/2024/metadata")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	if handlerCalled {
		t.Error("handler should not be called when auth blocks")
	}
}

// Test public endpoints bypass auth
func TestNewRouter_PublicBypassesAuth(t *testing.T) {
	logger := slog.Default()
	c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
	if err != nil {
		t.Fatalf("cors.NewHandler: %v", err)
	}
	auth := &mockAuthMiddleware{blockAccess: true}

	healthCalled := false
	router := NewRouter(
		RouterConfig{CORSHandler: c, AuthMiddleware: auth},
		PublicRoutes{
			Health:      func(w http.ResponseWriter, r *http.Request) { healthCalled = true },
			Ready:       func(w http.ResponseWriter, r *http.Request) {},
			SportConfig: func(w http.ResponseWriter, r *http.Request) {},
		},
		noopAuthRoutes(),
		logger,
	)

	req := corsRequest(http.MethodGet, "/health")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if !healthCalled {
		t.Error("health handler should be called even with blocking auth")
	}
}

// Test CORS preflight handling
func TestNewRouter_CORSPreflight(t *testing.T) {
	logger := slog.Default()
	c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
	if err != nil {
		t.Fatalf("cors.NewHandler: %v", err)
	}
	auth := &mockAuthMiddleware{}
	router := newTestRouter(c, auth, logger)

	paths := []string{"/health", "/v1/activities/2024/metrics"}
	for _, path := range paths {
		req := corsRequest(http.MethodOptions, path)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Header().Get("Access-Control-Allow-Origin") == "" {
			t.Errorf("CORS preflight not handled for %s", path)
		}
	}
}

// Test undefined routes return proper status codes
func TestNewRouter_UndefinedRoutes(t *testing.T) {
	logger := slog.Default()
	c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
	if err != nil {
		t.Fatalf("cors.NewHandler: %v", err)
	}
	auth := &mockAuthMiddleware{}
	router := newTestRouter(c, auth, logger)

	t.Run("POST to GET-only endpoint returns 405", func(t *testing.T) {
		req := corsRequest(http.MethodPost, "/health")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("undefined path returns 404", func(t *testing.T) {
		req := corsRequest(http.MethodGet, "/undefined/path")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})
}

// TestNewRouter_AuthRateLimiterScopedToAuth asserts that the auth-scoped rate
// limiter applies only to /auth/* routes and does NOT additionally gate /v1/*.
// Built with very low rates so that the second /auth/* hit must be rejected,
// while same-pattern hits to /v1/sports/config remain allowed.
func TestNewRouter_AuthRateLimiterScopedToAuth(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	logger := gcplog.NewNoOpLogger()
	c, err := cors.NewHandler([]string{"https://example.com"}, logger, false)
	if err != nil {
		t.Fatalf("cors.NewHandler: %v", err)
	}
	auth := &mockAuthMiddleware{}

	// Auth limiter: 1 req/s, burst 1 — second hit in quick succession is rejected.
	authLimiter := ratelimit.New(ctx, &ratelimit.Config{
		Rate:            1,
		Burst:           1,
		CleanupInterval: time.Hour,
		TTL:             time.Hour,
	}, logger)

	// Global limiter: high rate so it doesn't interfere with the test.
	globalLimiter := ratelimit.New(ctx, &ratelimit.Config{
		Rate:            1000,
		Burst:           1000,
		CleanupInterval: time.Hour,
		TTL:             time.Hour,
	}, logger)

	router := NewRouter(
		RouterConfig{
			CORSHandler:     c,
			AuthMiddleware:  auth,
			RateLimiter:     globalLimiter,
			AuthRateLimiter: authLimiter,
		},
		PublicRoutes{
			Health:       func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) },
			Ready:        func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) },
			SportConfig:  func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) },
			AuthInitiate: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) },
			AuthCallback: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) },
		},
		noopAuthRoutes(),
		slog.Default(),
	)

	const clientIP = "9.9.9.9:5555"

	t.Run("auth limiter gates /auth/strava", func(t *testing.T) {
		// First request: allowed (within burst).
		req1 := corsRequest(http.MethodGet, "/auth/strava")
		req1.RemoteAddr = clientIP
		w1 := httptest.NewRecorder()
		router.ServeHTTP(w1, req1)
		if w1.Code != http.StatusOK {
			t.Fatalf("first /auth/strava: status = %d, want 200", w1.Code)
		}

		// Second request in quick succession: rejected with 429.
		req2 := corsRequest(http.MethodGet, "/auth/strava")
		req2.RemoteAddr = clientIP
		w2 := httptest.NewRecorder()
		router.ServeHTTP(w2, req2)
		if w2.Code != http.StatusTooManyRequests {
			t.Errorf("second /auth/strava: status = %d, want 429", w2.Code)
		}
	})

	t.Run("auth limiter gates /auth/callback", func(t *testing.T) {
		// Use a fresh IP so the auth limiter's burst is full for this client.
		const cbIP = "9.9.9.10:5555"

		req1 := corsRequest(http.MethodGet, "/auth/callback")
		req1.RemoteAddr = cbIP
		w1 := httptest.NewRecorder()
		router.ServeHTTP(w1, req1)
		if w1.Code != http.StatusOK {
			t.Fatalf("first /auth/callback: status = %d, want 200", w1.Code)
		}

		req2 := corsRequest(http.MethodGet, "/auth/callback")
		req2.RemoteAddr = cbIP
		w2 := httptest.NewRecorder()
		router.ServeHTTP(w2, req2)
		if w2.Code != http.StatusTooManyRequests {
			t.Errorf("second /auth/callback: status = %d, want 429", w2.Code)
		}
	})

	t.Run("auth limiter does NOT gate /v1/sports/config", func(t *testing.T) {
		// Self-contained: pre-exhaust the auth limiter for a fresh IP, then
		// assert /v1/* is still reachable from that IP. If the auth limiter
		// were accidentally applied to /v1/*, the throttled IP would be
		// rejected here.
		const v1IP = "9.9.9.11:5555"

		// Burn the auth-limiter burst for v1IP via /auth/strava — first hit
		// allowed, second 429.
		for i := range 2 {
			req := corsRequest(http.MethodGet, "/auth/strava")
			req.RemoteAddr = v1IP
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if i == 1 && w.Code != http.StatusTooManyRequests {
				t.Fatalf("expected /auth/strava to be throttled for v1IP after first hit, got %d", w.Code)
			}
		}

		// Now /v1/sports/config from the same throttled IP must still succeed.
		for i := range 5 {
			req := corsRequest(http.MethodGet, "/v1/sports/config")
			req.RemoteAddr = v1IP
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Errorf("request %d to /v1/sports/config (auth-throttled IP): status = %d, want 200", i, w.Code)
			}
		}
	})
}
