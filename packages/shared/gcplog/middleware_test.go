package gcplog

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func TestHTTPRequestLogger_LogsRequest(t *testing.T) {
	logger, handler := NewCaptureLogger()

	// Create a simple handler that returns 200
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Build the middleware chain
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/test", nextHandler)

	// Make request
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("User-Agent", "test-agent")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Verify response
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify log was captured
	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	log := logs[0]
	if log.Message != "HTTP Request" {
		t.Errorf("expected message 'HTTP Request', got %q", log.Message)
	}
	if log.Level != slog.LevelInfo {
		t.Errorf("expected INFO level for 200 status, got %v", log.Level)
	}
	if log.Attrs["method"] != "GET" {
		t.Errorf("expected method GET, got %v", log.Attrs["method"])
	}
	if log.Attrs["path"] != "/test" {
		t.Errorf("expected path /test, got %v", log.Attrs["path"])
	}
	if log.Attrs["status"] != 200 {
		t.Errorf("expected status 200, got %v", log.Attrs["status"])
	}
	if log.Attrs["user_agent"] != "test-agent" {
		t.Errorf("expected user_agent test-agent, got %v", log.Attrs["user_agent"])
	}
}

func TestHTTPRequestLogger_StatusBasedLevels(t *testing.T) {
	tests := []struct {
		name          string
		status        int
		expectedLevel slog.Level
	}{
		{"200 OK logs INFO", http.StatusOK, slog.LevelInfo},
		{"201 Created logs INFO", http.StatusCreated, slog.LevelInfo},
		{"301 Redirect logs INFO", http.StatusMovedPermanently, slog.LevelInfo},
		{"400 Bad Request logs WARN", http.StatusBadRequest, slog.LevelWarn},
		{"401 Unauthorized logs WARN", http.StatusUnauthorized, slog.LevelWarn},
		{"404 Not Found logs WARN", http.StatusNotFound, slog.LevelWarn},
		{"500 Internal Error logs ERROR", http.StatusInternalServerError, slog.LevelError},
		{"502 Bad Gateway logs ERROR", http.StatusBadGateway, slog.LevelError},
		{"503 Unavailable logs ERROR", http.StatusServiceUnavailable, slog.LevelError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger, handler := NewCaptureLogger()

			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
			})

			r := chi.NewRouter()
			r.Use(middleware.RequestID)
			r.Use(HTTPRequestLogger(logger))
			r.Get("/", nextHandler)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			logs := handler.Logs()
			if len(logs) != 1 {
				t.Fatalf("expected 1 log entry, got %d", len(logs))
			}

			if logs[0].Level != tt.expectedLevel {
				t.Errorf("expected level %v for status %d, got %v", tt.expectedLevel, tt.status, logs[0].Level)
			}
		})
	}
}

func TestHTTPRequestLogger_CapturesBytesWritten(t *testing.T) {
	logger, handler := NewCaptureLogger()

	responseBody := "Hello, World!"
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(responseBody))
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	bytes, ok := logs[0].Attrs["bytes"].(int)
	if !ok {
		t.Fatalf("expected bytes to be int, got %T", logs[0].Attrs["bytes"])
	}
	if bytes != len(responseBody) {
		t.Errorf("expected bytes %d, got %d", len(responseBody), bytes)
	}
}

func TestHTTPRequestLogger_IncludesRequestID(t *testing.T) {
	logger, handler := NewCaptureLogger()

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	requestID, ok := logs[0].Attrs["request_id"].(string)
	if !ok {
		t.Fatalf("expected request_id to be string, got %T", logs[0].Attrs["request_id"])
	}
	if requestID == "" {
		t.Error("expected non-empty request_id")
	}
}
