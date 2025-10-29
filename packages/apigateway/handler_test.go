package apigateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/storage"
)

// mockStorageClient is a mock implementation for testing
type mockStorageClient struct {
	ReadJSONFunc func(ctx context.Context, blobPath string) (interface{}, error)
}

func (m *mockStorageClient) ReadJSON(ctx context.Context, blobPath string) (interface{}, error) {
	if m.ReadJSONFunc != nil {
		return m.ReadJSONFunc(ctx, blobPath)
	}
	return nil, storage.ErrNotFound
}

func TestHandlerHealth(t *testing.T) {
	mock := &mockStorageClient{}
	handler := NewHandlerWithStorage(mock)

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
	mock := &mockStorageClient{}
	handler := NewHandlerWithStorage(mock)

	t.Run("preflight with allowed origin", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

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
	testData := map[string]interface{}{
		"distance_traveled": []interface{}{
			map[string]interface{}{"x": "2024-01-01", "y": 10.5},
		},
	}

	mock := &mockStorageClient{
		ReadJSONFunc: func(ctx context.Context, blobPath string) (interface{}, error) {
			if blobPath == "activities/2024/distances.json" {
				return testData, nil
			}
			return nil, storage.ErrNotFound
		},
	}

	handler := NewHandlerWithStorage(mock)

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

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
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
