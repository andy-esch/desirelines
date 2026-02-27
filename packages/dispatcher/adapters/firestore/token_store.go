// Package firestore provides Firestore-backed adapters for the dispatcher.
package firestore

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TokenStore implements ports.TokenStore using Firestore.
type TokenStore struct {
	client *firestore.Client
	logger *slog.Logger
}

// Compile-time check that TokenStore implements ports.TokenStore.
var _ ports.TokenStore = (*TokenStore)(nil)

// NewTokenStore creates a new Firestore-backed token store.
func NewTokenStore(client *firestore.Client, logger *slog.Logger) *TokenStore {
	return &TokenStore{
		client: client,
		logger: logger,
	}
}

// GetTokens reads Strava tokens for the given athlete from Firestore.
// Returns ports.ErrTokenNotFound if no tokens exist for this athlete.
func (s *TokenStore) GetTokens(ctx context.Context, athleteID int64) (*stravatoken.Data, error) {
	doc, err := s.tokensRef(athleteID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, ports.ErrTokenNotFound
		}
		return nil, fmt.Errorf("get tokens for athlete %d: %w", athleteID, err)
	}

	var tokens stravatoken.Data
	if decodeErr := doc.DataTo(&tokens); decodeErr != nil {
		return nil, fmt.Errorf("decode tokens for athlete %d: %w", athleteID, decodeErr)
	}

	return &tokens, nil
}

// WriteTokens writes updated Strava tokens for the given athlete to Firestore.
// It uses Update with explicit fields so that fields owned by apigateway
// (scopes, connected_at) are preserved.
func (s *TokenStore) WriteTokens(ctx context.Context, athleteID int64, tokens *stravatoken.Data) error {
	if _, err := s.tokensRef(athleteID).Update(ctx, []firestore.Update{
		{Path: "access_token", Value: tokens.AccessToken},
		{Path: "refresh_token", Value: tokens.RefreshToken},
		{Path: "expires_at", Value: tokens.ExpiresAt},
		{Path: "last_refreshed", Value: time.Now()},
	}); err != nil {
		return fmt.Errorf("write tokens for athlete %d: %w", athleteID, err)
	}

	return nil
}

// WriteTokensIfUnmodified atomically writes tokens only if last_refreshed matches
// the expected value (optimistic concurrency). Returns ports.ErrTokenConflict if
// another goroutine has already refreshed the tokens since they were read.
func (s *TokenStore) WriteTokensIfUnmodified(ctx context.Context, athleteID int64, tokens *stravatoken.Data, expectedLastRefreshed time.Time) error {
	ref := s.tokensRef(athleteID)

	err := s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		snap, getErr := tx.Get(ref)
		if getErr != nil {
			return fmt.Errorf("read tokens in transaction: %w", getErr)
		}

		var current stravatoken.Data
		if decodeErr := snap.DataTo(&current); decodeErr != nil {
			return fmt.Errorf("decode tokens in transaction: %w", decodeErr)
		}

		// Check version: if last_refreshed has changed, another thread won the race.
		if !current.LastRefreshed.Equal(expectedLastRefreshed) {
			return ports.ErrTokenConflict
		}

		return tx.Update(ref, []firestore.Update{
			{Path: "access_token", Value: tokens.AccessToken},
			{Path: "refresh_token", Value: tokens.RefreshToken},
			{Path: "expires_at", Value: tokens.ExpiresAt},
			{Path: "last_refreshed", Value: time.Now()},
		})
	})

	if err != nil {
		if errors.Is(err, ports.ErrTokenConflict) {
			return ports.ErrTokenConflict
		}
		return fmt.Errorf("write tokens for athlete %d: %w", athleteID, err)
	}
	return nil
}

// tokensRef returns the Firestore document reference for an athlete's tokens.
func (s *TokenStore) tokensRef(athleteID int64) *firestore.DocumentRef {
	return s.client.Collection(stravatoken.UsersCollection).Doc(strconv.FormatInt(athleteID, 10)).Collection(stravatoken.PrivateCollection).Doc(stravatoken.TokensDocument)
}
