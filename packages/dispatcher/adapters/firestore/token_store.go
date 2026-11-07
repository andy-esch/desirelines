// Package firestore provides Firestore-backed adapters for the dispatcher.
package firestore

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

const dbSystem = "firestore"

// TokenStore binds credential reads and mutations to a live ownership pair.
type TokenStore struct {
	client    *firestore.Client
	histogram metric.Float64Histogram
	tracer    trace.Tracer
}

var _ ports.TokenStore = (*TokenStore)(nil)

// NewTokenStore uses the same named database as the ownership registry.
func NewTokenStore(client *firestore.Client, histogram metric.Float64Histogram, tracer trace.Tracer) *TokenStore {
	return &TokenStore{client: client, histogram: histogram, tracer: tracer}
}

// ValidateOwner is uncached. Cache hits must still prove the original binding.
func (s *TokenStore) ValidateOwner(ctx context.Context, owner ports.CredentialOwner) error {
	if validationErr := owner.Validate(); validationErr != nil {
		return fmt.Errorf("credential owner: %w", validationErr)
	}
	if err := s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		return s.checkOwner(tx, owner)
	}); err != nil {
		return fmt.Errorf("validate credential owner: %w", err)
	}
	return nil
}

func (s *TokenStore) checkOwner(tx *firestore.Transaction, owner ports.CredentialOwner) error {
	record, err := (activityconnection.Store{Client: s.client}).ResolveInTransaction(tx, strconv.FormatInt(owner.Subject, 10))
	if err != nil {
		return fmt.Errorf("resolve credential owner: %w", err)
	}
	if record.UID != owner.UID {
		return activityconnection.ErrConflict
	}
	return nil
}

// GetTokens reads the active pair and UID-keyed credentials in one snapshot.
// Only a missing credential document is ErrTokenNotFound; registry failures retry.
func (s *TokenStore) GetTokens(ctx context.Context, owner ports.CredentialOwner) (_ *stravatoken.Data, err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.get_tokens", attribute.Int64("athlete_id", owner.Subject), attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()
	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "get_tokens"))
	defer func() { done(err) }()
	if validationErr := owner.Validate(); validationErr != nil {
		return nil, fmt.Errorf("credential owner: %w", validationErr)
	}
	var tokens stravatoken.Data
	err = s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if checkErr := s.checkOwner(tx, owner); checkErr != nil {
			return checkErr
		}
		snap, getErr := tx.Get(s.tokensRef(owner))
		if grpcstatus.Code(getErr) == codes.NotFound {
			return ports.ErrTokenNotFound
		}
		if getErr != nil {
			return fmt.Errorf("read credentials: %w", getErr)
		}
		// DataTo does not reset fields absent from a later snapshot. A retry
		// must decode into a fresh value, never retain an earlier credential.
		var attempt stravatoken.Data
		if decodeErr := snap.DataTo(&attempt); decodeErr != nil {
			return fmt.Errorf("decode credentials: %w", decodeErr)
		}
		if validateErr := attempt.Validate(); validateErr != nil {
			return fmt.Errorf("stored credentials: %w", validateErr)
		}
		tokens = attempt
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("get credentials: %w", err)
	}
	return &tokens, nil
}

// WriteTokensIfUnmodified revalidates the captured binding on every transaction
// attempt. Update cannot recreate a deleted credential document. External OAuth
// refresh happens before this method, never inside the retryable callback.
func (s *TokenStore) WriteTokensIfUnmodified(ctx context.Context, owner ports.CredentialOwner, tokens *stravatoken.Data, expectedLastRefreshed time.Time) (_ time.Time, err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.write_tokens", attribute.Int64("athlete_id", owner.Subject), attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()
	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "write_tokens"))
	defer func() { done(err) }()
	if validationErr := owner.Validate(); validationErr != nil {
		return time.Time{}, fmt.Errorf("credential owner: %w", validationErr)
	}
	if tokens == nil {
		return time.Time{}, stravatoken.ErrIncompleteTokens
	}
	// Freeze caller-owned data before any SDK retry.
	write := *tokens
	if err = write.Validate(); err != nil {
		return time.Time{}, fmt.Errorf("refreshed credentials: %w", err)
	}
	now := time.Now().Truncate(time.Microsecond)
	ref := s.tokensRef(owner)
	err = s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if checkErr := s.checkOwner(tx, owner); checkErr != nil {
			return checkErr
		}
		snap, getErr := tx.Get(ref)
		if grpcstatus.Code(getErr) == codes.NotFound {
			return ports.ErrTokenNotFound
		}
		if getErr != nil {
			return fmt.Errorf("read credentials in transaction: %w", getErr)
		}
		var current stravatoken.Data
		if decodeErr := snap.DataTo(&current); decodeErr != nil {
			return fmt.Errorf("decode credentials in transaction: %w", decodeErr)
		}
		if !current.LastRefreshed.Equal(expectedLastRefreshed) {
			return ports.ErrTokenConflict
		}
		if updateErr := tx.Update(ref, []firestore.Update{
			{Path: "access_token", Value: write.AccessToken}, {Path: "refresh_token", Value: write.RefreshToken},
			{Path: "expires_at", Value: write.ExpiresAt}, {Path: "last_refreshed", Value: now},
		}); updateErr != nil {
			return fmt.Errorf("update credentials: %w", updateErr)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ports.ErrTokenConflict) {
			return time.Time{}, ports.ErrTokenConflict
		}
		if errors.Is(err, ports.ErrTokenNotFound) {
			return time.Time{}, ports.ErrTokenNotFound
		}
		return time.Time{}, fmt.Errorf("write credentials: %w", err)
	}
	return now, nil
}

// DeleteTokens removes credentials only while the original pair is still active.
// Admission is deliberately irrelevant to grant-confirmed deauthorization.
func (s *TokenStore) DeleteTokens(ctx context.Context, owner ports.CredentialOwner) (err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.delete_tokens", attribute.Int64("athlete_id", owner.Subject), attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()
	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "delete_tokens"))
	defer func() { done(err) }()
	if validationErr := owner.Validate(); validationErr != nil {
		return fmt.Errorf("credential owner: %w", validationErr)
	}
	ref := s.tokensRef(owner)
	err = s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if checkErr := s.checkOwner(tx, owner); checkErr != nil {
			return checkErr
		}
		if deleteErr := tx.Delete(ref); deleteErr != nil {
			return fmt.Errorf("delete credentials: %w", deleteErr)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete credentials: %w", err)
	}
	return nil
}

func (s *TokenStore) tokensRef(owner ports.CredentialOwner) *firestore.DocumentRef {
	return s.client.Collection(stravatoken.UsersCollection).Doc(owner.UID).Collection(stravatoken.PrivateCollection).Doc(stravatoken.TokensDocument)
}
