// Package mock provides development-only adapters that replace external services.
package mock

import (
	"context"
	"log/slog"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Compile-time checks that AuthStore satisfies both interfaces.
var (
	_ auth.TokenStore       = (*AuthStore)(nil)
	_ auth.AllowlistChecker = (*AuthStore)(nil)
)

// AuthStore is a no-op implementation of TokenStore and AllowlistChecker
// for local development. It always allows access and discards token writes.
type AuthStore struct {
	logger *slog.Logger
}

// NewAuthStore creates a mock auth store for local development.
func NewAuthStore(logger *slog.Logger) *AuthStore {
	return &AuthStore{logger: logger}
}

// IsAllowed always returns true in local development.
func (s *AuthStore) IsAllowed(_ context.Context, athleteID string) (bool, error) {
	s.logger.Debug("Mock allowlist: allowing athlete", "athlete_id", athleteID)
	return true, nil
}

// WriteAuthData logs the write and discards it (no Firestore in local dev).
func (s *AuthStore) WriteAuthData(_ context.Context, athleteID string, _ *stravatoken.Data, _ *auth.AthleteProfile) error {
	s.logger.Debug("Mock auth store: discarding token write", "athlete_id", athleteID)
	return nil
}
