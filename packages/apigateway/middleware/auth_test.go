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

// TestParseAllowedEmails_Empty tests warning when no emails configured
func TestParseAllowedEmails_Empty(t *testing.T) {
	t.Setenv("ALLOWED_EMAILS", "")

	logger := slog.Default()
	allowedEmails := parseAllowedEmails(logger)

	if len(allowedEmails) != 0 {
		t.Error("Expected empty allowedEmails map when ALLOWED_EMAILS not set")
	}
}

// TestParseAllowedEmails_WithEmails tests email configuration parsing
func TestParseAllowedEmails_WithEmails(t *testing.T) {
	t.Setenv("ALLOWED_EMAILS", "user1@example.com, user2@example.com, admin@example.com")

	logger := slog.Default()
	allowedEmails := parseAllowedEmails(logger)

	expectedEmails := map[string]bool{
		"user1@example.com": true,
		"user2@example.com": true,
		"admin@example.com": true,
	}

	if len(allowedEmails) != len(expectedEmails) {
		t.Errorf("Expected %d allowed emails, got %d", len(expectedEmails), len(allowedEmails))
	}

	for email := range expectedEmails {
		if !allowedEmails[email] {
			t.Errorf("Expected email %s to be in allowlist", email)
		}
	}
}

// TestParseAllowedEmails_TrimsWhitespace tests that whitespace is properly trimmed
func TestParseAllowedEmails_TrimsWhitespace(t *testing.T) {
	t.Setenv("ALLOWED_EMAILS", "  user@example.com  ,  admin@example.com  ")

	logger := slog.Default()
	allowedEmails := parseAllowedEmails(logger)

	if !allowedEmails["user@example.com"] {
		t.Error("Expected 'user@example.com' (trimmed) to be in allowlist")
	}
	if !allowedEmails["admin@example.com"] {
		t.Error("Expected 'admin@example.com' (trimmed) to be in allowlist")
	}
	if len(allowedEmails) != 2 {
		t.Errorf("Expected 2 emails, got %d", len(allowedEmails))
	}
}
