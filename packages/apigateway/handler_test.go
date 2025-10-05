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

	req := httptest.NewRequest(http.MethodOptions, "/health", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204, got %d", w.Code)
	}

	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("expected CORS headers to be set")
	}
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
