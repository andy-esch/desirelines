// Package middleware provides HTTP middleware functions for the API Gateway.
package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
)

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
type AuthMiddleware struct {
	authClient     *auth.Client
	allowedEmails  map[string]bool
	skipValidation bool // For local development
	corsHandler    *cors.Handler
}

// sendErrorWithCORS sends a JSON error response with appropriate CORS headers.
func (m *AuthMiddleware) sendErrorWithCORS(w http.ResponseWriter, r *http.Request, status int, message string) {
	m.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	errorResponse := map[string]string{"error": message}
	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		log.Printf("Error encoding error response: %v", err)
	}
}

// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware(ctx context.Context) (*AuthMiddleware, error) {
	// Initialize CORS handler (used for both local and production)
	corsHandler := cors.NewHandler()

	// Check if running in local mode
	dataSource := os.Getenv("DATA_SOURCE")
	if dataSource == "local-fixtures" {
		log.Println("Auth: Running in local mode - skipping Firebase validation")
		return &AuthMiddleware{
			skipValidation: true,
			corsHandler:    corsHandler,
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
			}
		}
		log.Printf("Auth: Configured %d authorized email(s)", len(allowedEmails))
	}

	log.Println("Auth middleware initialized successfully")
	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: allowedEmails,
		corsHandler:   corsHandler,
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
			log.Printf("Auth: Authentication failed - reason: missing_header")
			m.sendErrorWithCORS(w, r, http.StatusUnauthorized, "Authentication failed")
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			log.Printf("Auth: Authentication failed - reason: invalid_header_format")
			m.sendErrorWithCORS(w, r, http.StatusUnauthorized, "Authentication failed")
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			log.Printf("Auth: Authentication failed - reason: token_verification_failed")
			m.sendErrorWithCORS(w, r, http.StatusUnauthorized, "Authentication failed")
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			log.Printf("Auth: Authentication failed - reason: missing_email_claim")
			m.sendErrorWithCORS(w, r, http.StatusUnauthorized, "Authentication failed")
			return
		}

		// Check if email is in allowlist
		if !m.allowedEmails[email] {
			log.Printf("Auth: Authorization failed - reason: email_not_authorized")
			m.sendErrorWithCORS(w, r, http.StatusForbidden, "Access denied")
			return
		}

		// Email is authorized, proceed
		log.Printf("Auth: Request authorized successfully")
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
		corsHandler:   cors.NewHandler(),
	}
}
