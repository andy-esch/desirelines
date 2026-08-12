package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"google.golang.org/api/idtoken"
)

const oidcValidationTimeout = 5 * time.Second

var errInvalidOIDCPayload = errors.New("validated OIDC token has invalid claims")

// OIDCValidator is the subset of Google's ID-token validator needed by the
// readiness endpoint. Keeping the interface narrow makes the authorization
// boundary testable without minting real Google credentials.
type OIDCValidator interface {
	Validate(ctx context.Context, token, audience string) (*idtoken.Payload, error)
}

// OIDCAuthMiddleware authenticates a single trusted service-account subject.
// It protects operational endpoints that are hosted on an otherwise-public
// Cloud Run service, such as the DB-touching /ready probe.
type OIDCAuthMiddleware struct {
	validator       OIDCValidator
	audience        string
	expectedSubject string
	logger          *slog.Logger
}

// NewOIDCAuthMiddleware creates service-to-service OIDC middleware. audience
// must match the Cloud Scheduler token's aud claim; expectedSubject is the
// scheduler service account's immutable numeric unique ID, not its mutable
// display name or email.
func NewOIDCAuthMiddleware(validator OIDCValidator, audience, expectedSubject string, logger *slog.Logger) *OIDCAuthMiddleware {
	return &OIDCAuthMiddleware{
		validator:       validator,
		audience:        audience,
		expectedSubject: expectedSubject,
		logger:          logger,
	}
}

// Middleware verifies the Google-signed OIDC token, its audience, issuer, and
// immutable service-account subject before allowing the request through.
func (m *OIDCAuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") ||
			strings.TrimSpace(parts[1]) == "" || len(parts[1]) > maxBearerTokenLength {
			m.reject(w, r, "missing_or_invalid_header", nil)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), oidcValidationTimeout)
		payload, err := m.validator.Validate(ctx, parts[1], m.audience)
		cancel()
		if err != nil {
			m.reject(w, r, "token_validation_failed", err)
			return
		}
		if payload == nil || payload.Subject != m.expectedSubject ||
			(payload.Issuer != "https://accounts.google.com" && payload.Issuer != "accounts.google.com") ||
			payload.IssuedAt <= 0 || payload.IssuedAt > time.Now().Add(time.Minute).Unix() {
			m.reject(w, r, "claims_mismatch", errInvalidOIDCPayload)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (m *OIDCAuthMiddleware) reject(w http.ResponseWriter, r *http.Request, reason string, err error) {
	attrs := []any{"reason", reason}
	if err != nil {
		attrs = append(attrs, "error", err)
	}
	m.logger.Warn("Operational endpoint authentication failed", attrs...)
	w.Header().Set("WWW-Authenticate", "Bearer")
	apierrors.WriteError(w, r, apierrors.ErrUnauthorized, m.logger)
}
