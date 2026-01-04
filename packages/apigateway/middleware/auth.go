// Package middleware provides HTTP middleware functions for the API Gateway.
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
type AuthMiddleware struct {
	authClient    *auth.Client
	allowedEmails map[string]bool
}

// NewFirebaseAuth creates authentication middleware using Firebase Admin SDK.
// It validates JWT tokens and checks the email against an allowlist from ALLOWED_EMAILS env var.
func NewFirebaseAuth(ctx context.Context) (*AuthMiddleware, error) {
	// Parse allowed emails from environment variable
	allowedEmails := parseAllowedEmails()

	// Initialize Firebase Admin SDK
	// ProjectID is required for token verification (even with emulator)
	// In Cloud Run, ADC provides credentials automatically
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}

	config := &firebase.Config{
		ProjectID: projectID,
	}
	app, err := firebase.NewApp(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}

	logger.Logger.Info("Auth middleware initialized successfully", "project_id", projectID)
	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: allowedEmails,
	}, nil
}

// parseAllowedEmails extracts allowed emails from environment variable.
func parseAllowedEmails() map[string]bool {
	allowedEmailsEnv := os.Getenv("ALLOWED_EMAILS")
	if allowedEmailsEnv == "" {
		logger.Logger.Warn("ALLOWED_EMAILS not set - no users will be authorized")
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
	logger.Logger.Info("Auth: Configured authorized emails", "count", len(allowedEmails))
	return allowedEmails
}

// Middleware is the HTTP middleware function that validates authentication.
//
// Authentication failure reason codes logged for monitoring and debugging:
//   - missing_header: Authorization header not present in request
//   - invalid_header_format: Authorization header malformed (not "Bearer <token>")
//   - token_verification_failed: Firebase ID token verification failed
//   - missing_email_claim: Token verified but email claim missing or empty
//   - email_not_authorized: Email not in ALLOWED_EMAILS configuration
//
// These reason codes can be used for log aggregation and alerting.
func (m *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			logger.Logger.Warn("Auth: Authentication failed", "reason", "missing_header")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized)
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			logger.Logger.Warn("Auth: Authentication failed", "reason", "invalid_header_format")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized)
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			logger.Logger.Warn("Auth: Authentication failed", "reason", "token_verification_failed", "error", err)
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized)
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			logger.Logger.Warn("Auth: Authentication failed", "reason", "missing_email_claim")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized)
			return
		}

		// Check if email is in allowlist
		if !m.allowedEmails[email] {
			logger.Logger.Warn("Auth: Authorization failed", "reason", "email_not_authorized", "email", email)
			apierrors.WriteError(w, r, apierrors.ErrForbidden)
			return
		}

		// Email is authorized, proceed
		logger.Logger.Info("Auth: Request authorized successfully", "email", email)
		next.ServeHTTP(w, r)
	})
}
