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
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/errors"
)

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
type AuthMiddleware struct {
	authClient     *auth.Client
	allowedEmails  map[string]bool
	skipValidation bool // For local development
	corsHandler    errors.CORSHandler
}


// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware(ctx context.Context) (*AuthMiddleware, error) {
	// Initialize CORS handler (used for both local and production)
	corsHandler := cors.NewHandler()

	// Parse allowed emails from environment variable (used in both modes)
	allowedEmails := parseAllowedEmails()

	// Check if running in local mode
	dataSource := os.Getenv("DATA_SOURCE")
	if dataSource == "local-fixtures" {
		log.Println("Auth: Running in local mode - skipping Firebase validation")
		return &AuthMiddleware{
			skipValidation: true,
			corsHandler:    corsHandler,
			allowedEmails:  allowedEmails,
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

	log.Println("Auth middleware initialized successfully")
	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: allowedEmails,
		corsHandler:   corsHandler,
	}, nil
}

// parseAllowedEmails extracts allowed emails from environment variable.
func parseAllowedEmails() map[string]bool {
	allowedEmailsEnv := os.Getenv("ALLOWED_EMAILS")
	if allowedEmailsEnv == "" {
		log.Println("Warning: ALLOWED_EMAILS not set - no users will be authorized")
		return make(map[string]bool)
	}

	allowedEmails := make(map[string]bool)
	emails := strings.Split(allowedEmailsEnv, ",")
	for _, email := range emails {
		email = strings.TrimSpace(email)
		if email != "" {
			allowedEmails[email] = true
		}
	}
	log.Printf("Auth: Configured %d authorized email(s)", len(allowedEmails))
	return allowedEmails
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
			errors.WriteError(w, r, errors.ErrUnauthorized, m.corsHandler)
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			log.Printf("Auth: Authentication failed - reason: invalid_header_format")
			errors.WriteError(w, r, errors.ErrUnauthorized, m.corsHandler)
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			log.Printf("Auth: Authentication failed - reason: token_verification_failed")
			errors.WriteError(w, r, errors.ErrUnauthorized, m.corsHandler)
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			log.Printf("Auth: Authentication failed - reason: missing_email_claim")
			errors.WriteError(w, r, errors.ErrUnauthorized, m.corsHandler)
			return
		}

		// Check if email is in allowlist
		if !m.allowedEmails[email] {
			log.Printf("Auth: Authorization failed - reason: email_not_authorized")
			errors.WriteError(w, r, errors.ErrForbidden, m.corsHandler)
			return
		}

		// Email is authorized, proceed
		log.Printf("Auth: Request authorized successfully")
		next.ServeHTTP(w, r)
	})
}
