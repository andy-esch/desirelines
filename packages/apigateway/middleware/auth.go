package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// contextKey is an unexported type for context keys to avoid collisions.
type contextKey int

const (
	// userIDKey is the context key for the authenticated user's ID (Firebase UID).
	userIDKey contextKey = iota
)

// WithUserID returns a copy of ctx with the given user ID set.
// Used by the auth middleware to inject the authenticated user's ID,
// and by tests to set up authenticated request contexts.
func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, userIDKey, uid)
}

// GetUserID extracts the authenticated user's ID from the request context.
// Returns empty string if no user ID is present (e.g., unauthenticated request).
func GetUserID(ctx context.Context) string {
	uid, ok := ctx.Value(userIDKey).(string)
	if !ok {
		return ""
	}
	return uid
}

// TokenVerifier defines the interface for verifying ID tokens.
// This allows mocking the Firebase Auth client in tests.
type TokenVerifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error)
}

// AuthMiddleware validates Firebase ID tokens and injects the user ID into
// the request context. Access control is handled by the Firestore athlete ID
// allowlist (checked during OAuth callback), not by this middleware.
type AuthMiddleware struct {
	verifier  TokenVerifier
	logger    *slog.Logger
	histogram metric.Float64Histogram
}

// NewAuthMiddleware creates authentication middleware with a pre-initialized token verifier.
// The Firebase app and auth client should be initialized in main.go and passed here.
func NewAuthMiddleware(verifier TokenVerifier, logger *slog.Logger, histogram metric.Float64Histogram) *AuthMiddleware {
	logger.Info("Auth middleware initialized successfully")
	return &AuthMiddleware{
		verifier:  verifier,
		logger:    logger,
		histogram: histogram,
	}
}

// Middleware is the HTTP middleware function that validates authentication.
//
// Authentication failure reason codes logged for monitoring and debugging:
//   - missing_header: Authorization header not present in request
//   - invalid_header_format: Authorization header malformed (not "Bearer <token>")
//   - token_verification_failed: Firebase ID token verification failed
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
		done := otel.RecordDuration(r.Context(), m.histogram, attribute.String("result", "pending"))
		token, err := m.verifier.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			done(err)
			m.logger.Warn("Auth: Authentication failed", "reason", "token_verification_failed", "error", err)
			gcplog.WriteError(w, r, gcplog.ErrUnauthorized, m.logger)
			return
		}
		done(nil)

		// Token verified — inject UID into context and proceed.
		// The UID is the Strava athlete ID (as string), matching the
		// PostgreSQL user_id column.
		ctx := WithUserID(r.Context(), token.UID)
		m.logger.Debug("Auth: Request authorized successfully", "uid", token.UID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
