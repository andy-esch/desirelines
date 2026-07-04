package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	otelTrace "go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
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
	tracer    otelTrace.Tracer
}

// NewAuthMiddleware creates authentication middleware with a pre-initialized token verifier.
// The Firebase app and auth client should be initialized in main.go and passed here.
//
// The tracer is used to emit an `auth.verify_id_token` span around the
// Firebase token verification call. Pass nil to disable (span no-ops);
// production callers thread providers.Tracer through from the OTel setup.
func NewAuthMiddleware(verifier TokenVerifier, logger *slog.Logger, histogram metric.Float64Histogram, tracer otelTrace.Tracer) *AuthMiddleware {
	if tracer == nil {
		tracer = tracenoop.NewTracerProvider().Tracer("")
	}
	logger.Info("Auth middleware initialized successfully")
	return &AuthMiddleware{
		verifier:  verifier,
		logger:    logger,
		histogram: histogram,
		tracer:    tracer,
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
			m.rejectUnauthorized(w, r, "missing_header")
			return
		}

		// Parse "Bearer <token>". Reject a blank token (e.g. "Bearer " with a
		// trailing space splits to ["Bearer", ""]) here rather than handing an
		// empty/whitespace string to Firebase, which would 401 anyway after a
		// network round-trip.
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" || strings.TrimSpace(parts[1]) == "" {
			m.rejectUnauthorized(w, r, "invalid_header_format")
			return
		}

		idToken := parts[1]

		// Verify the ID token with Firebase. Span captures user-perceived
		// auth latency; histogram captures the time-series for alerting.
		// Both record the err so failed verifications are stamped on each.
		ctx, spanDone := otel.StartSpan(r.Context(), m.tracer, "auth.verify_id_token")
		done := otel.RecordDuration(ctx, m.histogram)
		token, err := m.verifier.VerifyIDToken(ctx, idToken)
		done(err)
		spanDone(err)
		if err != nil {
			m.rejectUnauthorized(w, r, "token_verification_failed", "error", err)
			return
		}

		// Token verified — inject UID into context and proceed. We base
		// the user-id context on r.Context() (NOT the auth-span ctx above,
		// which is now closed) so downstream handlers create their spans
		// as children of the otelhttp server span, not the closed auth span.
		ctx = WithUserID(r.Context(), token.UID)

		// Stamp the verified user ID onto the active OTel server span so Cloud
		// Trace can filter "all traces for user X". Uses the OTel semantic-
		// convention key `enduser.id`. No-op if there's no active span.
		if span := otelTrace.SpanFromContext(ctx); span.SpanContext().IsValid() {
			span.SetAttributes(attribute.String("enduser.id", token.UID))
		}

		m.logger.Debug("Auth: Request authorized successfully", "uid", token.UID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// rejectUnauthorized logs an authentication failure with the given reason
// code (plus any extra structured attrs, e.g. "error", err) and writes a 401
// response. Callers must return immediately after invoking it.
func (m *AuthMiddleware) rejectUnauthorized(w http.ResponseWriter, r *http.Request, reason string, attrs ...any) {
	m.logger.Warn("Auth: Authentication failed", append([]any{"reason", reason}, attrs...)...)
	apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
}
