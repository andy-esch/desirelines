package apigateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/storage"
	"github.com/go-chi/chi/v5"
)

// mockStorageClient is a mock implementation for testing
type mockStorageClient struct {
	ReadJSONFunc func(ctx context.Context, blobPath string) (any, error)
}

func (m *mockStorageClient) ReadJSON(ctx context.Context, blobPath string) (any, error) {
	if m.ReadJSONFunc != nil {
		return m.ReadJSONFunc(ctx, blobPath)
	}
	return nil, storage.ErrNotFound
}

// mockAuthMiddleware is a no-op auth middleware for testing
type mockAuthMiddleware struct{}

func (m *mockAuthMiddleware) Middleware(next http.Handler) http.Handler {
	// Pass through without authentication (like local development mode)
	return next
}

// newHandlerWithStorage creates a handler with injected dependencies for testing
func newHandlerWithStorage(storageClient storage.Client, sportConfig *config.SportConfig) *Handler {
	// Create a mock auth middleware for testing
	mockAuth := &mockAuthMiddleware{}

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	// Initialize chi router
	r := chi.NewRouter()

	h := &Handler{
		storage:        storageClient,
		authMiddleware: mockAuth,
		corsHandler:    corsHandler,
		router:         r,
		sportConfig:    sportConfig,
	}

	// Register routes
	h.registerRoutes()

	return h
}

// newTestHandler creates a handler with mock dependencies for testing
func newTestHandler(storageClient storage.Client) *Handler {
	// Load sport config for tests (uses embedded config)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		panic("Failed to load sport config for tests: " + err.Error())
	}
	return newHandlerWithStorage(storageClient, sportConfig)
}

func TestHandlerHealth(t *testing.T) {
	mock := &mockStorageClient{}
	handler := newTestHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", contentType)
	}
}

func TestHandlerCORS(t *testing.T) {
	t.Run("preflight with allowed origin", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create handler AFTER setting env var so CORS handler reads correct config
		mock := &mockStorageClient{}
		handler := newTestHandler(mock)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://desirelines-dev.web.app")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", w.Code)
		}

		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "https://desirelines-dev.web.app" {
			t.Errorf("expected CORS origin to be https://desirelines-dev.web.app, got %s", allowedOrigin)
		}

		allowMethods := w.Header().Get("Access-Control-Allow-Methods")
		if allowMethods != "GET, OPTIONS" {
			t.Errorf("expected Allow-Methods to be GET, OPTIONS, got %s", allowMethods)
		}
	})

	t.Run("preflight with disallowed origin", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create handler AFTER setting env var so CORS handler reads correct config
		mock := &mockStorageClient{}
		handler := newTestHandler(mock)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://evil.com")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", w.Code)
		}

		// Should NOT set CORS header for disallowed origin
		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "" {
			t.Errorf("expected no CORS origin for disallowed origin, got %s", allowedOrigin)
		}
	})

	t.Run("localhost origin for dev", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create handler AFTER setting env var so CORS handler reads correct config
		mock := &mockStorageClient{}
		handler := newTestHandler(mock)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "http://localhost:5173" {
			t.Errorf("expected CORS origin to be http://localhost:5173, got %s", allowedOrigin)
		}
	})

	t.Run("no ALLOWED_ORIGINS env var blocks all origins", func(t *testing.T) {
		// Ensure ALLOWED_ORIGINS is not set
		t.Setenv("ALLOWED_ORIGINS", "")

		// Create handler AFTER setting env var so CORS handler reads correct config
		mock := &mockStorageClient{}
		handler := newTestHandler(mock)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://any-origin.com")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		// Should NOT set any CORS header (secure by default)
		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "" {
			t.Errorf("expected no CORS origin when ALLOWED_ORIGINS not set, got %s", allowedOrigin)
		}
	})
}

func TestHandlerActivities(t *testing.T) {
	testData := map[string]any{
		"distance_traveled": []any{
			map[string]any{"x": "2024-01-01", "y": 10.5},
		},
	}

	mock := &mockStorageClient{
		ReadJSONFunc: func(ctx context.Context, blobPath string) (any, error) {
			if blobPath == "activities/2024/distances.json" {
				return testData, nil
			}
			return nil, storage.ErrNotFound
		},
	}

	handler := newTestHandler(mock)

	t.Run("successful request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/distances", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2023/distances", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})

	t.Run("invalid data type", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/invalid", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		// http.ServeMux returns 404 for non-matching routes (better than custom 400)
		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})

	t.Run("method not allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/activities/2024/distances", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected status 405, got %d", w.Code)
		}
	})
}

func TestHandlerMetrics(t *testing.T) {
	mockData := map[string]any{
		"timeseries": []any{
			map[string]any{"date": "2024-01-15", "distance": 68400, "time": 120},
		},
	}

	mock := &mockStorageClient{
		ReadJSONFunc: func(ctx context.Context, blobPath string) (any, error) {
			if blobPath == "activities/2024/metrics/cycling.json" {
				return mockData, nil
			}
			return nil, storage.ErrNotFound
		},
	}

	handler := newTestHandler(mock)

	t.Run("valid sport parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=invalid", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("sport not found in storage", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=yoga", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})
}

func TestHandlerSource(t *testing.T) {
	mockData := map[string]any{
		"2024-01-15": map[string]any{
			"distance": 8370,
			"time":     48,
		},
	}

	mock := &mockStorageClient{
		ReadJSONFunc: func(ctx context.Context, blobPath string) (any, error) {
			if blobPath == "activities/2024/source/running.json" {
				return mockData, nil
			}
			return nil, storage.ErrNotFound
		},
	}

	handler := newTestHandler(mock)

	t.Run("valid sport parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=badminton", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerMetadata(t *testing.T) {
	mockData := map[string]any{
		"year":   2024,
		"sports": []string{"cycling", "running"},
		"totals": map[string]any{
			"cycling": map[string]any{
				"distance":   136800,
				"activities": 4,
			},
		},
	}

	mock := &mockStorageClient{
		ReadJSONFunc: func(ctx context.Context, blobPath string) (any, error) {
			if blobPath == "activities/2024/metadata.json" {
				return mockData, nil
			}
			return nil, storage.ErrNotFound
		},
	}

	handler := newTestHandler(mock)

	t.Run("returns metadata successfully", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("metadata not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/activities/2023/metadata", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})
}

func TestHandlerSportConfig(t *testing.T) {
	mock := &mockStorageClient{}
	handler := newTestHandler(mock)

	req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify response contains sport categories
	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}
