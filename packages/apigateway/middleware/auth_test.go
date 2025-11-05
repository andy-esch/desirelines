package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"firebase.google.com/go/v4/auth"
)

// mockAuthClient is a mock Firebase auth client for testing
type mockAuthClient struct {
	verifyIDTokenFunc func(ctx context.Context, idToken string) (*auth.Token, error)
}

func (m *mockAuthClient) VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error) {
	if m.verifyIDTokenFunc != nil {
		return m.verifyIDTokenFunc(ctx, idToken)
	}
	return nil, nil
}

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

	middleware := NewAuthMiddlewareWithClient(nil, []string{"test@example.com"})

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

	middleware := NewAuthMiddlewareWithClient(nil, []string{"test@example.com"})

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

// TestAuthMiddleware_TokenVerificationFailed tests invalid tokens
func TestAuthMiddleware_TokenVerificationFailed(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	// Mock auth client that rejects all tokens
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return nil, &auth.Error{Code: auth.IDTokenInvalid}
		},
	}

	middleware := NewAuthMiddlewareWithClient(mockClient, []string{"test@example.com"})

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := middleware.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid_token")
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestAuthMiddleware_MissingEmailClaim tests tokens without email claim
func TestAuthMiddleware_MissingEmailClaim(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	// Mock auth client that returns token without email
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return &auth.Token{
				UID:    "user123",
				Claims: map[string]interface{}{}, // No email claim
			}, nil
		},
	}

	middleware := NewAuthMiddlewareWithClient(mockClient, []string{"test@example.com"})

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := middleware.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid_token_no_email")
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestAuthMiddleware_UnauthorizedEmail tests valid token with unauthorized email
func TestAuthMiddleware_UnauthorizedEmail(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	// Mock auth client that returns valid token
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return &auth.Token{
				UID: "user123",
				Claims: map[string]interface{}{
					"email": "unauthorized@example.com",
				},
			}, nil
		},
	}

	// Only allow different email
	middleware := NewAuthMiddlewareWithClient(mockClient, []string{"allowed@example.com"})

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called for unauthorized email")
	})

	handler := middleware.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid_token")
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d", w.Code)
	}
}

// TestAuthMiddleware_ValidToken tests successful authentication
func TestAuthMiddleware_ValidToken(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	authorizedEmail := "test@example.com"

	// Mock auth client that returns valid token with authorized email
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return &auth.Token{
				UID: "user123",
				Claims: map[string]interface{}{
					"email": authorizedEmail,
				},
			}, nil
		},
	}

	middleware := NewAuthMiddlewareWithClient(mockClient, []string{authorizedEmail})

	handlerCalled := false
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := middleware.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid_token")
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if !handlerCalled {
		t.Error("Expected next handler to be called for valid token")
	}
}

// TestAuthMiddleware_MultipleAllowedEmails tests multiple authorized users
func TestAuthMiddleware_MultipleAllowedEmails(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com")

	allowedEmails := []string{
		"user1@example.com",
		"user2@example.com",
		"admin@example.com",
	}

	testCases := []struct {
		email          string
		expectedStatus int
		shouldCallNext bool
	}{
		{"user1@example.com", http.StatusOK, true},
		{"user2@example.com", http.StatusOK, true},
		{"admin@example.com", http.StatusOK, true},
		{"unauthorized@example.com", http.StatusForbidden, false},
	}

	for _, tc := range testCases {
		t.Run(tc.email, func(t *testing.T) {
			mockClient := &mockAuthClient{
				verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
					return &auth.Token{
						UID: "user123",
						Claims: map[string]interface{}{
							"email": tc.email,
						},
					}, nil
				},
			}

			middleware := NewAuthMiddlewareWithClient(mockClient, allowedEmails)

			handlerCalled := false
			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusOK)
			})

			handler := middleware.Middleware(nextHandler)

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Authorization", "Bearer valid_token")
			req.Header.Set("Origin", "https://example.com")
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tc.expectedStatus {
				t.Errorf("Expected status %d, got %d", tc.expectedStatus, w.Code)
			}

			if handlerCalled != tc.shouldCallNext {
				t.Errorf("Expected handlerCalled=%v, got %v", tc.shouldCallNext, handlerCalled)
			}
		})
	}
}

// TestAuthMiddleware_CORSHeaders tests that CORS headers are set correctly
func TestAuthMiddleware_CORSHeaders(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://example.com,https://other.com")

	middleware := NewAuthMiddlewareWithClient(nil, []string{"test@example.com"})

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := middleware.Middleware(nextHandler)

	testCases := []struct {
		name         string
		origin       string
		expectHeader bool
	}{
		{"Allowed origin", "https://example.com", true},
		{"Another allowed origin", "https://other.com", true},
		{"Disallowed origin", "https://evil.com", false},
		{"No origin", "", false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			corsHeader := w.Header().Get("Access-Control-Allow-Origin")
			if tc.expectHeader && corsHeader != tc.origin {
				t.Errorf("Expected CORS header %s, got %s", tc.origin, corsHeader)
			}
			if !tc.expectHeader && corsHeader != "" {
				t.Errorf("Expected no CORS header, got %s", corsHeader)
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
