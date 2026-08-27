package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

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
	// Future context keys belong in this iota block. HTTP and timeout constants
	// are declared separately below so adding a key cannot change their meaning.
)

const (
	maxBearerTokenLength = 8 << 10
	accessCheckTimeout   = 5 * time.Second
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

// AccessChecker verifies that an authenticated Firebase UID remains authorized
// to use this environment. The Firestore athlete allowlist implements this
// interface. Checking on every request makes allowlist removal/deauthorization
// effective without waiting for an already-issued Firebase ID token to expire.
// A composition-root cache may bound that change by a short positive TTL.
type AccessChecker interface {
	IsAllowed(ctx context.Context, userID string) (bool, error)
}

// AuthMiddleware validates Firebase ID tokens, optionally re-checks current
// allowlist access, and injects the user ID into the request context.
type AuthMiddleware struct {
	verifier  TokenVerifier
	access    AccessChecker
	logger    *slog.Logger
	histogram metric.Float64Histogram
	// accessHistogram times the allowlist re-check. Separate from `histogram`
	// (Firebase verification) because the two answer different questions and a
	// shared instrument would blur a slow allowlist into token-verify latency.
	// Nil when there is no access checker, or from callers that don't meter.
	accessHistogram metric.Float64Histogram
	tracer          otelTrace.Tracer
}

// NewAuthMiddleware creates authentication middleware with a pre-initialized token verifier.
// The Firebase app and auth client should be initialized in main.go and passed here.
//
// The tracer is used to emit an `auth.verify_id_token` span around the
// Firebase token verification call. Pass nil to disable (span no-ops);
// production callers thread providers.Tracer through from the OTel setup.
func NewAuthMiddleware(verifier TokenVerifier, logger *slog.Logger, histogram metric.Float64Histogram, tracer otelTrace.Tracer) *AuthMiddleware {
	return newAuthMiddleware(verifier, nil, logger, histogram, tracer)
}

// NewAuthMiddlewareWithAccessCheck creates authentication middleware that also
// re-checks the user's current authorization after token verification. Production
// and local composition roots should use this constructor; the shorter constructor
// remains useful for focused verifier tests and examples.
func NewAuthMiddlewareWithAccessCheck(verifier TokenVerifier, access AccessChecker, logger *slog.Logger, histogram, accessHistogram metric.Float64Histogram, tracer otelTrace.Tracer) *AuthMiddleware {
	m := newAuthMiddleware(verifier, access, logger, histogram, tracer)
	m.accessHistogram = accessHistogram
	return m
}

func newAuthMiddleware(verifier TokenVerifier, access AccessChecker, logger *slog.Logger, histogram metric.Float64Histogram, tracer otelTrace.Tracer) *AuthMiddleware {
	if tracer == nil {
		tracer = tracenoop.NewTracerProvider().Tracer("")
	}
	logger.Info("Auth middleware initialized successfully")
	return &AuthMiddleware{
		verifier:  verifier,
		access:    access,
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
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
			m.rejectUnauthorized(w, r, "invalid_header_format")
			return
		}

		idToken := parts[1]
		if len(idToken) > maxBearerTokenLength {
			m.rejectUnauthorized(w, r, "token_too_large")
			return
		}

		// Verify the ID token with Firebase. Span captures user-perceived
		// auth latency; histogram captures the time-series for alerting.
		// Both record the err so failed verifications are stamped on each.
		ctx, spanDone := otel.StartSpan(r.Context(), m.tracer, "auth.verify_id_token")
		done := otel.RecordDuration(ctx, m.histogram)
		token, err := m.verifier.VerifyIDToken(ctx, idToken)
		verifyErr := err
		if verifyErr == nil && (token == nil || token.UID == "") {
			verifyErr = errors.New("verified token has no UID")
		}
		done(verifyErr)
		spanDone(verifyErr)
		if verifyErr != nil {
			m.rejectUnauthorized(w, r, "token_verification_failed", "error", verifyErr)
			return
		}

		if m.access != nil {
			accessCtx, cancel := context.WithTimeout(r.Context(), accessCheckTimeout)
			// Span + histogram pairing, matching auth.verify_id_token above: the
			// span shows one request's latency, the histogram gives the
			// alertable time-series. The check was previously traced only, so a
			// degraded allowlist backend had no metric to alert on.
			spanCtx, accessSpanDone := otel.StartSpan(accessCtx, m.tracer, "auth.check_access")
			accessDone := otel.RecordDuration(spanCtx, m.accessHistogram)
			allowed, accessErr := m.access.IsAllowed(spanCtx, token.UID)
			accessDone(accessErr)
			accessSpanDone(accessErr)
			cancel()
			if accessErr != nil {
				m.logger.Error("Auth: Access check failed", "error", accessErr, "uid", token.UID)
				apierrors.WriteCoded(w, r, m.logger, http.StatusServiceUnavailable,
					"AUTHORIZATION_UNAVAILABLE", "Authorization temporarily unavailable", "access check failed")
				return
			}
			if !allowed {
				m.logger.Warn("Auth: User no longer authorized", "uid", token.UID)
				apierrors.WriteError(w, r, apierrors.ErrForbidden, m.logger)
				return
			}
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
	w.Header().Set("WWW-Authenticate", "Bearer")
	apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
}
