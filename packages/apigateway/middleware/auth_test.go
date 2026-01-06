package middleware

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAuthMiddleware_MissingAuthorizationHeader tests rejection of requests without auth header
func TestAuthMiddleware_MissingAuthorizationHeader(t *testing.T) {
	// Set CORS origins for test
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	logger := slog.Default()

	// Create middleware with allowed emails
	// authClient is nil so token verification would fail, but we test headers first
	middleware := &AuthMiddleware{
		allowedEmails: map[string]bool{"test@example.com": true},
		authClient:    nil,
		logger:        logger,
	}

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := middleware.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}

	// Check response contains error
	body := w.Body.String()
	if body == "" {
		t.Error("Expected error response body")
	}
}

// TestAuthMiddleware_InvalidAuthorizationHeaderFormat tests malformed auth headers
func TestAuthMiddleware_InvalidAuthorizationHeaderFormat(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	logger := slog.Default()

	middleware := &AuthMiddleware{
		allowedEmails: map[string]bool{"test@example.com": true},
		authClient:    nil,
		logger:        logger,
	}

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := middleware.Middleware(nextHandler)

	testCases := []struct {
		name      string
		authValue string
	}{
		{"No Bearer prefix", "InvalidToken123"},
		{"Wrong scheme", "Basic dXNlcjpwYXNz"},
		{"Only Bearer", "Bearer"},
		{"Empty", ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tc.authValue != "" {
				req.Header.Set("Authorization", tc.authValue)
			}
			req.Header.Set("Origin", "https://example.com")
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Errorf("Expected status 401, got %d", w.Code)
			}
		})
	}
}
