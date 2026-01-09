package middleware

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"firebase.google.com/go/v4/auth"
)

// MockTokenVerifier implements TokenVerifier interface
type MockTokenVerifier struct {
	VerifyErr error
	Token     *auth.Token
}

func (m *MockTokenVerifier) VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error) {
	return m.Token, m.VerifyErr
}

func TestAuthMiddleware(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	allowedEmails := map[string]bool{
		"allowed@example.com": true,
	}

	tests := []struct {
		name           string
		header         string
		mockVerifier   *MockTokenVerifier
		expectedStatus int
	}{
		{
			name:           "Missing Authorization header",
			header:         "",
			mockVerifier:   &MockTokenVerifier{},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Invalid header format",
			header:         "InvalidToken",
			mockVerifier:   &MockTokenVerifier{},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:   "Invalid token",
			header: "Bearer invalid-token",
			mockVerifier: &MockTokenVerifier{
				VerifyErr: errors.New("invalid token"),
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:   "Valid token but missing email claim",
			header: "Bearer valid-token",
			mockVerifier: &MockTokenVerifier{
				Token: &auth.Token{
					Claims: map[string]interface{}{},
				},
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:   "Valid token but unauthorized email",
			header: "Bearer valid-token",
			mockVerifier: &MockTokenVerifier{
				Token: &auth.Token{
					Claims: map[string]interface{}{
						"email": "denied@example.com",
					},
				},
			},
			expectedStatus: http.StatusForbidden,
		},
		{
			name:   "Valid token and authorized email",
			header: "Bearer valid-token",
			mockVerifier: &MockTokenVerifier{
				Token: &auth.Token{
					Claims: map[string]interface{}{
						"email": "allowed@example.com",
					},
				},
			},
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := &AuthMiddleware{
				verifier:      tt.mockVerifier,
				allowedEmails: allowedEmails,
				logger:        logger,
			}

			// Create a dummy handler that returns 200 OK
			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := am.Middleware(nextHandler)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}
		})
	}
}
