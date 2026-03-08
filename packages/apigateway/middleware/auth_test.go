package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
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
	logger := gcplog.NewNoOpLogger()

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
			name:   "Valid token",
			header: "Bearer valid-token",
			mockVerifier: &MockTokenVerifier{
				Token: &auth.Token{
					UID: "12345",
				},
			},
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := &AuthMiddleware{
				verifier: tt.mockVerifier,
				logger:   logger,
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

func TestAuthMiddleware_InjectsUserID(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	verifier := &MockTokenVerifier{
		Token: &auth.Token{
			UID: "strava-12345",
		},
	}

	am := &AuthMiddleware{
		verifier: verifier,
		logger:   logger,
	}

	var capturedUID string
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUID = GetUserID(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := am.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if capturedUID != "strava-12345" {
		t.Errorf("GetUserID() = %q, want %q", capturedUID, "strava-12345")
	}
}

func TestGetUserID_MissingFromContext(t *testing.T) {
	ctx := context.Background()
	uid := GetUserID(ctx)
	if uid != "" {
		t.Errorf("GetUserID() = %q, want empty string", uid)
	}
}
