package middleware

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func TestLogger(t *testing.T) {
	// Create a buffer to capture logs
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, nil)
	logger := slog.New(handler)

	// Create a router with the middleware
	r := chi.NewRouter()
	r.Use(middleware.RequestID) // Ensure RequestID is present
	r.Use(Logger(logger))

	// Define test handler
	r.Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, err := w.Write([]byte("ok"))
		if err != nil {
			t.Fatalf("failed to write response: %v", err)
		}
	})

	// Perform request
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	req.Header.Set("User-Agent", "TestAgent")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Verify response
	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", w.Code, http.StatusCreated)
	}

	// Verify logs
	var logEntry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &logEntry); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}

	// Check standard fields
	if logEntry["msg"] != "HTTP Request" {
		t.Errorf("msg = %q, want %q", logEntry["msg"], "HTTP Request")
	}
	if logEntry["method"] != "GET" {
		t.Errorf("method = %q, want %q", logEntry["method"], "GET")
	}
	if logEntry["path"] != "/test" {
		t.Errorf("path = %q, want %q", logEntry["path"], "/test")
	}
	if status, ok := logEntry["status"].(float64); !ok || status != 201 {
		t.Errorf("status = %v, want 201", logEntry["status"])
	}
	if logEntry["remote_ip"] != "1.2.3.4:1234" {
		t.Errorf("remote_ip = %q, want %q", logEntry["remote_ip"], "1.2.3.4:1234")
	}
	if logEntry["user_agent"] != "TestAgent" {
		t.Errorf("user_agent = %q, want %q", logEntry["user_agent"], "TestAgent")
	}
	if _, ok := logEntry["request_id"].(string); !ok {
		t.Error("request_id missing or not string")
	}
	if _, ok := logEntry["duration"]; !ok {
		t.Error("duration missing")
	}
}

func TestLogger_NoRequestID(t *testing.T) {
	// Test behavior when RequestID middleware is missing (should verify graceful handling)
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	r := chi.NewRouter()
	r.Use(Logger(logger))
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var logEntry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &logEntry); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}

	// Should still log, request_id might be empty string
	if logEntry["request_id"] != "" {
		t.Errorf("expected empty request_id, got %v", logEntry["request_id"])
	}
}
