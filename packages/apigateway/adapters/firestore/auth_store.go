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
	doc, err := s.client.Collection("allowlist").Doc(athleteID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, fmt.Errorf("check allowlist: %w", err)
	}
	return doc.Exists(), nil
}

// WriteTokens writes Strava tokens to the user's private subcollection.
// Path: users/{athleteID}/private/strava_tokens
func (s *AuthStore) WriteTokens(ctx context.Context, athleteID string, tokens *auth.StravaTokenData) error {
	_, err := s.client.Collection("users").Doc(athleteID).Collection("private").Doc("strava_tokens").Set(ctx, tokens, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("write strava tokens: %w", err)
	}
	return nil
}

// WriteProfile writes the athlete profile to the user's private subcollection.
// Path: users/{athleteID}/private/profile
func (s *AuthStore) WriteProfile(ctx context.Context, athleteID string, profile *auth.AthleteProfile) error {
	_, err := s.client.Collection("users").Doc(athleteID).Collection("private").Doc("profile").Set(ctx, profile, firestore.MergeAll)
	if err != nil {
		return fmt.Errorf("write athlete profile: %w", err)
	}
	return nil
}
