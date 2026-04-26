package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
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
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		data := map[string]string{"message": "hello"}
		RespondJSON(w, req, http.StatusOK, data, logger)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}

		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}
	})

	t.Run("encodes struct to JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		type TestData struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		}
		data := TestData{Name: "test", Count: 42}
		RespondJSON(w, req, http.StatusOK, data, logger)

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
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			w := httptest.NewRecorder()

			RespondJSON(w, req, code, nil, logger)

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
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		rawJSON := []byte(`{"raw":"data","number":123}`)
		RespondRawJSON(w, req, http.StatusOK, rawJSON, logger)

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
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		// Pre-marshaled JSON
		rawJSON := []byte(`{"key":"value"}`)
		RespondRawJSON(w, req, http.StatusOK, rawJSON, logger)

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
		c := cors.NewHandler([]string{"https://example.com"}, logger)
		middleware := CORSMiddleware(c)

		nextCalled := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
		})

		req := httptest.NewRequest(http.MethodOptions, "/test", nil)
		req.Header.Set("Origin", "https://example.com")
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
		c := cors.NewHandler([]string{"https://example.com"}, logger)
		middleware := CORSMiddleware(c)

		nextCalled := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()

		middleware(next).ServeHTTP(w, req)

		if !nextCalled {
			t.Error("next handler should be called for GET request")
		}
	})

	t.Run("sets CORS headers before handler", func(t *testing.T) {
		c := cors.NewHandler([]string{"https://example.com"}, logger)
		middleware := CORSMiddleware(c)

		var corsHeaderSet bool
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check if CORS header was set before this handler ran
			corsHeaderSet = w.Header().Get("Access-Control-Allow-Origin") != ""
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()

		middleware(next).ServeHTTP(w, req)

		if !corsHeaderSet {
			t.Error("CORS headers should be set before next handler runs")
		}
	})
}

// noopAuthRoutes returns AuthenticatedRoutes with no-op handlers for testing.
func noopAuthRoutes() AuthenticatedRoutes {
	return AuthenticatedRoutes{
		GetMetadata:     func(w http.ResponseWriter, r *http.Request) {},
		GetMetrics:      func(w http.ResponseWriter, r *http.Request) {},
		GetSource:       func(w http.ResponseWriter, r *http.Request) {},
		GetRoutes:       func(w http.ResponseWriter, r *http.Request) {},
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
		{"routes (auth)", http.MethodGet, "/v1/activities/routes", true},
		{"list activities (auth)", http.MethodGet, "/v1/activities", true},
		{"get activity by ID (auth)", http.MethodGet, "/v1/activities/123", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := cors.NewHandler([]string{"https://example.com"}, logger)
			auth := &mockAuthMiddleware{}
			router := newTestRouter(c, auth, logger)

			req := httptest.NewRequest(tt.method, tt.path, nil)
			req.Header.Set("Origin", "https://example.com")
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
	c := cors.NewHandler([]string{"https://example.com"}, logger)
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

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metadata", nil)
	req.Header.Set("Origin", "https://example.com")
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
	c := cors.NewHandler([]string{"https://example.com"}, logger)
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

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if !healthCalled {
		t.Error("health handler should be called even with blocking auth")
	}
}

// Test CORS preflight handling
func TestNewRouter_CORSPreflight(t *testing.T) {
	logger := slog.Default()
	c := cors.NewHandler([]string{"https://example.com"}, logger)
	auth := &mockAuthMiddleware{}
	router := newTestRouter(c, auth, logger)

	paths := []string{"/health", "/v1/activities/2024/metrics"}
	for _, path := range paths {
		req := httptest.NewRequest(http.MethodOptions, path, nil)
		req.Header.Set("Origin", "https://example.com")
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
	c := cors.NewHandler([]string{"https://example.com"}, logger)
	auth := &mockAuthMiddleware{}
	router := newTestRouter(c, auth, logger)

	t.Run("POST to GET-only endpoint returns 405", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/health", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want %d", w.Code, http.StatusMethodNotAllowed)
		}
	})

	t.Run("undefined path returns 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/undefined/path", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})
}
