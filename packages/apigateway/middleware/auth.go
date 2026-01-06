// Package middleware provides HTTP middleware functions for the API Gateway.
package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/apierrors"
)

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
type AuthMiddleware struct {
	authClient    *auth.Client
	allowedEmails map[string]bool
	logger        *slog.Logger
}

// NewFirebaseAuth creates authentication middleware using Firebase Admin SDK.
// It validates JWT tokens and checks the email against an allowlist provided as configuration.
func NewFirebaseAuth(ctx context.Context, allowedEmails []string, logger *slog.Logger) (*AuthMiddleware, error) {
	// Convert slice to map for O(1) lookups
	emailMap := make(map[string]bool)
	for _, email := range allowedEmails {
		if email != "" {
			emailMap[email] = true
		}
	}

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

	if len(emailMap) == 0 {
		logger.Warn("Auth: No allowed emails configured - all authenticated requests will be forbidden")
	} else {
		logger.Info("Auth: Configured authorized emails", "count", len(emailMap))
	}

	logger.Info("Auth middleware initialized successfully", "project_id", projectID)
	return &AuthMiddleware{
		authClient:    authClient,
		allowedEmails: emailMap,
		logger:        logger,
	}, nil
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
			m.logger.Warn("Auth: Authentication failed", "reason", "missing_header")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			m.logger.Warn("Auth: Authentication failed", "reason", "invalid_header_format")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			m.logger.Warn("Auth: Authentication failed", "reason", "token_verification_failed", "error", err)
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			m.logger.Warn("Auth: Authentication failed", "reason", "missing_email_claim")
			apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
			return
		}

		// Check if email is in allowlist
		if !m.allowedEmails[email] {
			m.logger.Warn("Auth: Authorization failed", "reason", "email_not_authorized", "email", email)
			apierrors.WriteError(w, r, apierrors.ErrForbidden, m.logger)
			return
		}

		// Email is authorized, proceed
		m.logger.Info("Auth: Request authorized successfully", "email", email)
		next.ServeHTTP(w, r)
	})
}
