// Package mock provides development-only adapters that replace external services.
package mock

import (
	"context"
	"log/slog"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/allowlist"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Compile-time checks.
var (
	_ auth.TokenStore   = (*AuthStore)(nil)
	_ allowlist.Checker = (*AllowlistChecker)(nil)
)

// AuthStore is a no-op implementation of auth.TokenStore for local
// development. Token writes are logged and discarded.
type AuthStore struct {
	logger *slog.Logger
}

// NewAuthStore creates a mock auth store for local development.
func NewAuthStore(logger *slog.Logger) *AuthStore {
	return &AuthStore{logger: logger}
}

// WriteAuthData logs the write and discards it (no Firestore in local dev).
func (s *AuthStore) WriteAuthData(_ context.Context, athleteID string, _ *stravatoken.Data, _ *auth.AthleteProfile) error {
	s.logger.Debug("Mock auth store: discarding token write", "athlete_id", athleteID)
	return nil
}

// AllowlistChecker is a no-op implementation of allowlist.Checker for local
// development. Always returns allowed = true.
type AllowlistChecker struct {
	logger *slog.Logger
}

// NewAllowlistChecker creates a mock allowlist checker for local development.
func NewAllowlistChecker(logger *slog.Logger) *AllowlistChecker {
	return &AllowlistChecker{logger: logger}
}

// IsAllowed always returns true in local development.
func (c *AllowlistChecker) IsAllowed(_ context.Context, athleteID string) (bool, error) {
	c.logger.Debug("Mock allowlist: allowing athlete", "athlete_id", athleteID)
	return true, nil
}
