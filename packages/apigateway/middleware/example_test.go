package middleware_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/go-chi/chi/v5"
)

// mockTokenVerifier implements middleware.TokenVerifier for testing.
type mockTokenVerifier struct {
	email string
	err   error
}

func (m *mockTokenVerifier) VerifyIDToken(_ context.Context, _ string) (*auth.Token, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &auth.Token{
		Claims: map[string]interface{}{
			"email": m.email,
		},
	}, nil
}

func Example_authMiddlewareSetup() {
	// This example shows how auth middleware is typically configured.
	// In production, use NewFirebaseAuth which initializes the real Firebase client.

	logger := gcplog.NewNoOpLogger()

	// Create router with protected routes
	r := chi.NewRouter()

	// Public routes (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// In production, you would use:
	// auth, _ := middleware.NewFirebaseAuth(ctx, []string{"user@example.com"}, logger)
	// r.Route("/api", func(r chi.Router) {
	//     r.Use(auth.Middleware)
	//     r.Get("/activities", handleActivities)
	// })

	_ = logger // logger would be used with real middleware
	fmt.Println("middleware configured")
	// Output: middleware configured
}

func Example_tokenVerifierInterface() {
	// The TokenVerifier interface allows mocking Firebase in tests

	// Create a mock that always returns a valid token for test@example.com
	mock := &mockTokenVerifier{email: "test@example.com"}

	// Verify returns the mocked token
	token, err := mock.VerifyIDToken(context.Background(), "any-token")
	if err != nil {
		fmt.Println("error:", err)
		return
	}

	email := token.Claims["email"].(string)
	fmt.Println("verified email:", email)
	// Output: verified email: test@example.com
}

func Example_authenticationFlow() {
	// This example demonstrates the authentication flow without Firebase

	// Simulated request with Bearer token
	req := httptest.NewRequest("GET", "/api/activities", nil)
	req.Header.Set("Authorization", "Bearer test-token")

	// Extract token from header (this is what the middleware does)
	authHeader := req.Header.Get("Authorization")
	if authHeader == "" {
		fmt.Println("missing authorization header")
		return
	}

	// Parse "Bearer <token>"
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		fmt.Println("invalid header format")
		return
	}

	token := authHeader[7:]
	fmt.Println("extracted token:", token)
	// Output: extracted token: test-token
}
