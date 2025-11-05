package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// TestAuthMiddleware_LocalDevelopmentMode tests that auth is skipped in local mode
func TestAuthMiddleware_LocalDevelopmentMode(t *testing.T) {
	// Set environment to local mode
	t.Setenv("DATA_SOURCE", "local-fixtures")

	middleware, err := NewAuthMiddleware(context.Background())
	if err != nil {
		t.Fatalf("Failed to create auth middleware: %v", err)
	}

	if !middleware.skipValidation {
		t.Error("Expected skipValidation to be true in local mode")
	}

	// Create a test handler that sets a header to confirm it was called
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Handler-Called", "true")
		w.WriteHeader(http.StatusOK)
	})

	// Wrap with auth middleware
	handler := middleware.Middleware(nextHandler)

	// Make request without auth header (should pass in local mode)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if w.Header().Get("X-Handler-Called") != "true" {
		t.Error("Expected next handler to be called in local mode without auth")
	}
}

// TestAuthMiddleware_MissingAuthorizationHeader tests rejection of requests without auth header
func TestAuthMiddleware_MissingAuthorizationHeader(t *testing.T) {
	// Set CORS origins for test
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	// Create middleware with allowed emails but in non-local mode
	// We can't fully test without Firebase, but we can test header validation
	middleware := &AuthMiddleware{
		allowedEmails:  map[string]bool{"test@example.com": true},
		skipValidation: false,
		authClient:     nil, // Will fail at token verification, but we test headers first
		corsHandler:    nil, // Not needed for this test
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

	middleware := &AuthMiddleware{
		allowedEmails:  map[string]bool{"test@example.com": true},
		skipValidation: false,
		authClient:     nil,
		corsHandler:    nil,
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

// TestNewAuthMiddleware_NoAllowedEmails tests warning when no emails configured
func TestNewAuthMiddleware_NoAllowedEmails(t *testing.T) {
	// Clear environment
	os.Unsetenv("ALLOWED_EMAILS")
	t.Setenv("DATA_SOURCE", "local-fixtures")

	middleware, err := NewAuthMiddleware(context.Background())
	if err != nil {
		t.Fatalf("Failed to create auth middleware: %v", err)
	}

	if len(middleware.allowedEmails) != 0 {
		t.Error("Expected empty allowedEmails map when ALLOWED_EMAILS not set")
	}
}

// TestNewAuthMiddleware_WithAllowedEmails tests email configuration
func TestNewAuthMiddleware_WithAllowedEmails(t *testing.T) {
	t.Setenv("DATA_SOURCE", "local-fixtures")
	t.Setenv("ALLOWED_EMAILS", "user1@example.com, user2@example.com, admin@example.com")

	middleware, err := NewAuthMiddleware(context.Background())
	if err != nil {
		t.Fatalf("Failed to create auth middleware: %v", err)
	}

	expectedEmails := map[string]bool{
		"user1@example.com":  true,
		"user2@example.com":  true,
		"admin@example.com":  true,
	}

	if len(middleware.allowedEmails) != len(expectedEmails) {
		t.Errorf("Expected %d allowed emails, got %d", len(expectedEmails), len(middleware.allowedEmails))
	}

	for email := range expectedEmails {
		if !middleware.allowedEmails[email] {
			t.Errorf("Expected email %s to be in allowlist", email)
		}
	}
}
