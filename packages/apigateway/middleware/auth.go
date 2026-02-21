package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// TokenVerifier defines the interface for verifying ID tokens.
// This allows mocking the Firebase Auth client in tests.
type TokenVerifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error)
}

// AuthMiddleware validates Firebase ID tokens and checks email authorization.
//
// Design note: This middleware intentionally combines authentication (token verification)
// and authorization (email allowlist) because:
//   - The authorization model is simple (email allowlist, not RBAC)
//   - All protected routes require both auth + authz - no route needs auth without authz
//   - The TokenVerifier interface already enables comprehensive testing
//   - Splitting would add complexity (context passing) without concrete benefit
//
// If authorization needs grow complex (roles, resources, etc.), consider splitting.
type AuthMiddleware struct {
	verifier      TokenVerifier
	allowedEmails map[string]bool
	logger        *slog.Logger
}

// NewAuthMiddleware creates authentication middleware with a pre-initialized token verifier.
// The Firebase app and auth client should be initialized in main.go and passed here.
func NewAuthMiddleware(verifier TokenVerifier, allowedEmails []string, logger *slog.Logger) *AuthMiddleware {
	// Convert slice to map for O(1) lookups (normalize to lowercase)
	emailMap := make(map[string]bool)
	for _, email := range allowedEmails {
		if email != "" {
			emailMap[strings.ToLower(email)] = true
		}
	}

	if len(emailMap) == 0 {
		logger.Warn("Auth: No allowed emails configured - all authenticated requests will be forbidden")
	} else {
		logger.Info("Auth: Configured authorized emails", "count", len(emailMap))
	}

	logger.Info("Auth middleware initialized successfully")
	return &AuthMiddleware{
		verifier:      verifier,
		allowedEmails: emailMap,
		logger:        logger,
	}
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
			gcplog.WriteError(w, r, gcplog.ErrUnauthorized, m.logger)
			return
		}

		// Parse "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			m.logger.Warn("Auth: Authentication failed", "reason", "invalid_header_format")
			gcplog.WriteError(w, r, gcplog.ErrUnauthorized, m.logger)
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase
		token, err := m.verifier.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			m.logger.Warn("Auth: Authentication failed", "reason", "token_verification_failed", "error", err)
			gcplog.WriteError(w, r, gcplog.ErrUnauthorized, m.logger)
			return
		}

		// Extract email from token claims
		email, ok := token.Claims["email"].(string)
		if !ok || email == "" {
			m.logger.Warn("Auth: Authentication failed", "reason", "missing_email_claim")
			gcplog.WriteError(w, r, gcplog.ErrUnauthorized, m.logger)
			return
		}

		// Check if email is in allowlist (case-insensitive)
		if !m.allowedEmails[strings.ToLower(email)] {
			m.logger.Warn("Auth: Authorization failed", "reason", "email_not_authorized", "email", email)
			gcplog.WriteError(w, r, gcplog.ErrForbidden, m.logger)
			return
		}

		// Email is authorized, proceed
		m.logger.Debug("Auth: Request authorized successfully", "email", email)
		next.ServeHTTP(w, r)
	})
}
