// Package firestore provides Firestore-backed adapters for auth data storage.
package firestore

import (
	"context"
	"fmt"
	"log/slog"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// AuthStore implements auth.AllowlistChecker and auth.TokenStore using Firestore.
type AuthStore struct {
	client *firestore.Client
	logger *slog.Logger
}

// Compile-time checks.
var (
	_ auth.AllowlistChecker = (*AuthStore)(nil)
	_ auth.TokenStore       = (*AuthStore)(nil)
)

// NewAuthStore creates a new Firestore-backed auth store.
func NewAuthStore(client *firestore.Client, logger *slog.Logger) *AuthStore {
	return &AuthStore{
		client: client,
		logger: logger,
	}
}

// IsAllowed checks whether the given athlete ID exists in the allowlist collection.
func (s *AuthStore) IsAllowed(ctx context.Context, athleteID string) (bool, error) {
	_, err := s.client.Collection("allowlist").Doc(athleteID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, fmt.Errorf("check allowlist: %w", err)
	}
	return true, nil
}

// WriteAuthData atomically writes both Strava tokens and athlete profile.
// Uses a Firestore transaction to ensure both writes succeed or both fail.
//
// Paths:
//   - users/{athleteID}/private/strava_tokens
//   - users/{athleteID}/private/profile
func (s *AuthStore) WriteAuthData(ctx context.Context, athleteID string, tokens *auth.StravaTokenData, profile *auth.AthleteProfile) error {
	userPrivate := s.client.Collection("users").Doc(athleteID).Collection("private")
	tokensRef := userPrivate.Doc("strava_tokens")
	profileRef := userPrivate.Doc("profile")

	err := s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if setErr := tx.Set(tokensRef, tokens); setErr != nil {
			return fmt.Errorf("set strava tokens: %w", setErr)
		}

		// Preserve CreatedAt from existing profile (first-login timestamp).
		// On re-login, all other fields are updated but CreatedAt is retained.
		existingDoc, getErr := tx.Get(profileRef)
		if getErr == nil {
			var existing auth.AthleteProfile
			if decodeErr := existingDoc.DataTo(&existing); decodeErr == nil && !existing.CreatedAt.IsZero() {
				profile.CreatedAt = existing.CreatedAt
			}
		}

		if setErr := tx.Set(profileRef, profile); setErr != nil {
			return fmt.Errorf("set athlete profile: %w", setErr)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("write auth data: %w", err)
	}
	return nil
}
