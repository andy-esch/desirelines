// Package middleware provides HTTP middleware functions for the API Gateway.
package middleware

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
)

// Helper function to send error with CORS headers
func sendErrorWithCORS(w http.ResponseWriter, r *http.Request, status int, message string) {
	// Get allowed origins from environment
	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")
	if allowedOriginsEnv != "" {
		origin := r.Header.Get("Origin")
		allowedOrigins := strings.Split(allowedOriginsEnv, ",")
		for _, allowed := range allowedOrigins {
			if origin == strings.TrimSpace(allowed) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"error":"%s"}`, message)
}

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
type AuthMiddleware struct {
	authClient     *auth.Client
	allowedEmails  map[string]bool
	skipValidation bool // For local development
}

// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware(ctx context.Context) (*AuthMiddleware, error) {
	// Check if running in local mode
	dataSource := os.Getenv("DATA_SOURCE")
	if dataSource == "local-fixtures" {
		log.Println("Auth: Running in local mode - skipping Firebase validation")
		return &AuthMiddleware{
			skipValidation: true,
		}, nil
	}

	// Initialize Firebase Admin SDK
	// In Cloud Functions, this automatically uses Application Default Credentials
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}

	// Parse allowed emails from environment variable
	allowedEmailsEnv := os.Getenv("ALLOWED_EMAILS")
	if allowedEmailsEnv == "" {
		log.Println("Warning: ALLOWED_EMAILS not set - no users will be authorized")
	}

	allowedEmails := make(map[string]bool)
	if allowedEmailsEnv != "" {
		emails := strings.Split(allowedEmailsEnv, ",")
		for _, email := range emails {
			email = strings.TrimSpace(email)
			if email != "" {
				allowedEmails[email] = true
				log.Printf("Auth: Authorized email: %s", email)
			}
		}
	}

	log.Println("Auth middleware initialized successfully")
	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: allowedEmails,
	}, nil
}

// Middleware is the HTTP middleware function that validates authentication.
func (m *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip validation in local mode
		if m.skipValidation {
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			log.Printf("Auth: Missing Authorization header for %s", r.URL.Path)
			sendErrorWithCORS(w, r, http.StatusUnauthorized, "Unauthorized: Missing Authorization header")
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			log.Printf("Auth: Invalid Authorization header format for %s", r.URL.Path)
			sendErrorWithCORS(w, r, http.StatusUnauthorized, "Unauthorized: Invalid Authorization header format")
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			log.Printf("Auth: Token verification failed for %s: %v", r.URL.Path, err)
			sendErrorWithCORS(w, r, http.StatusUnauthorized, "Unauthorized: Invalid token")
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			log.Printf("Auth: No email in token claims for %s", r.URL.Path)
			sendErrorWithCORS(w, r, http.StatusUnauthorized, "Unauthorized: No email in token")
			return
		}

		// Check if email is in allowlist
		if !m.allowedEmails[email] {
			log.Printf("Auth: Email not authorized: %s (path: %s)", email, r.URL.Path)
			sendErrorWithCORS(w, r, http.StatusForbidden, "Forbidden: Email not authorized")
			return
		}

		// Email is authorized, proceed
		log.Printf("Auth: Authorized request for %s (email: %s)", r.URL.Path, email)
		next.ServeHTTP(w, r)
	})
}

// NewAuthMiddlewareWithClient creates an auth middleware with a custom auth client (for testing).
func NewAuthMiddlewareWithClient(authClient *auth.Client, allowedEmails []string) *AuthMiddleware {
	emailMap := make(map[string]bool)
	for _, email := range allowedEmails {
		emailMap[email] = true
	}

	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: emailMap,
	}
}
