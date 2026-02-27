// Package firestore provides Firestore-backed adapters for auth data storage.
package firestore

import (
	"context"
	"fmt"
	"log/slog"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
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
	_, err := s.client.Collection(stravatoken.AllowlistCollection).Doc(athleteID).Get(ctx)
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
func (s *AuthStore) WriteAuthData(ctx context.Context, athleteID string, tokens *stravatoken.Data, profile *auth.AthleteProfile) error {
	userPrivate := s.client.Collection(stravatoken.UsersCollection).Doc(athleteID).Collection(stravatoken.PrivateCollection)
	tokensRef := userPrivate.Doc(stravatoken.TokensDocument)
	profileRef := userPrivate.Doc(stravatoken.ProfileDocument)

	err := s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		// Firestore transactions require all reads before writes.
		// Preserve CreatedAt from existing profile (first-login timestamp).
		// On re-login, all other fields are updated but CreatedAt is retained.
		existingDoc, getErr := tx.Get(profileRef)
		if getErr == nil {
			var existing auth.AthleteProfile
			if decodeErr := existingDoc.DataTo(&existing); decodeErr == nil && !existing.CreatedAt.IsZero() {
				profile.CreatedAt = existing.CreatedAt
			}
		} else if status.Code(getErr) != codes.NotFound {
			return fmt.Errorf("get existing profile: %w", getErr)
		}

		if setErr := tx.Set(tokensRef, tokens); setErr != nil {
			return fmt.Errorf("set strava tokens: %w", setErr)
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
