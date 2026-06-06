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
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

// dbSystem is the OTel db.system value stamped on the Firestore
// token-store spans. Only db.system is set: the rest of the db.*
// triplet is SQL-shaped and has no honest Firestore mapping —
// db.name means a SQL database/schema (Firestore has none; a
// collection is db.collection.name, a different key) and db.operation
// would just restate the span name. Firestore's own client libraries
// emit gcp.firestore.* rather than db.* for the same reason. db.system
// alone gives the cross-database "this span is a DB call" marker that
// standardization is for; it coexists with the app-specific
// desirelines.* / athlete_id attributes.
const dbSystem = "firestore"

// TokenStore implements ports.TokenStore using Firestore.
type TokenStore struct {
	client    *firestore.Client
	logger    *slog.Logger
	histogram metric.Float64Histogram
	tracer    trace.Tracer
}

// Compile-time check that TokenStore implements ports.TokenStore.
var _ ports.TokenStore = (*TokenStore)(nil)

// NewTokenStore creates a new Firestore-backed token store.
func NewTokenStore(client *firestore.Client, logger *slog.Logger, histogram metric.Float64Histogram, tracer trace.Tracer) *TokenStore {
	return &TokenStore{
		client:    client,
		logger:    logger,
		histogram: histogram,
		tracer:    tracer,
	}
}

// GetTokens reads Strava tokens for the given athlete from Firestore.
// Returns ports.ErrTokenNotFound if no tokens exist for this athlete.
func (s *TokenStore) GetTokens(ctx context.Context, athleteID int64) (_ *stravatoken.Data, err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.get_tokens",
		attribute.Int64("athlete_id", athleteID),
		attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()

	// The "operation" metric label is intentionally kept even though the
	// span name above already identifies the operation: the
	// firestore/operation.duration alert groups P99 by it
	// (`sum by (le, metric_operation)` in alerts.tf), so dropping it
	// would silently collapse per-operation latency into a single figure.
	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "get_tokens"))
	doc, err := s.tokensRef(athleteID).Get(ctx)
	if err != nil {
		done(err)
		if grpcstatus.Code(err) == codes.NotFound {
			err = ports.ErrTokenNotFound
			return nil, err
		}
		err = fmt.Errorf("get tokens for athlete %d: %w", athleteID, err)
		return nil, err
	}
	done(nil)

	var tokens stravatoken.Data
	if decodeErr := doc.DataTo(&tokens); decodeErr != nil {
		err = fmt.Errorf("decode tokens for athlete %d: %w", athleteID, decodeErr)
		return nil, err
	}

	return &tokens, nil
}

// WriteTokensIfUnmodified atomically writes tokens only if last_refreshed matches
// the expected value (optimistic concurrency). Returns ports.ErrTokenConflict if
// another goroutine has already refreshed the tokens since they were read.
func (s *TokenStore) WriteTokensIfUnmodified(ctx context.Context, athleteID int64, tokens *stravatoken.Data, expectedLastRefreshed time.Time) (err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.write_tokens",
		attribute.Int64("athlete_id", athleteID),
		attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()

	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "write_tokens"))
	ref := s.tokensRef(athleteID)

	// Capture timestamp before the transaction so retries use a consistent value.
	now := time.Now()

	err = s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		snap, getErr := tx.Get(ref)
		if getErr != nil {
			// Doc was deleted between GetTokens and this transaction —
			// almost always the deauth/refresh race. Surface the
			// sentinel so the handler can ack as orphan instead of
			// looping through Strava retries.
			if grpcstatus.Code(getErr) == codes.NotFound {
				return ports.ErrTokenNotFound
			}
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
			{Path: "last_refreshed", Value: now},
		})
	})

	done(err)
	if err != nil {
		// Return the bare sentinels so callers classify via errors.Is; this
		// also keeps wrapcheck satisfied (the wrapped path is the fallback).
		if errors.Is(err, ports.ErrTokenConflict) {
			return ports.ErrTokenConflict
		}
		if errors.Is(err, ports.ErrTokenNotFound) {
			return ports.ErrTokenNotFound
		}
		return fmt.Errorf("write tokens for athlete %d: %w", athleteID, err)
	}
	return nil
}

// DeleteTokens removes all stored tokens for the given athlete.
// Returns nil if the tokens do not exist (Firestore Delete is idempotent).
func (s *TokenStore) DeleteTokens(ctx context.Context, athleteID int64) (err error) {
	ctx, spanDone := otel.StartSpan(ctx, s.tracer, "firestore.delete_tokens",
		attribute.Int64("athlete_id", athleteID),
		attribute.String("db.system", dbSystem))
	defer func() { spanDone(err) }()

	done := otel.RecordDuration(ctx, s.histogram, attribute.String("operation", "delete_tokens"))
	_, err = s.tokensRef(athleteID).Delete(ctx)
	done(err)
	if err != nil {
		err = fmt.Errorf("delete tokens for athlete %d: %w", athleteID, err)
		return err
	}
	return nil
}

// tokensRef returns the Firestore document reference for an athlete's tokens.
func (s *TokenStore) tokensRef(athleteID int64) *firestore.DocumentRef {
	return s.client.Collection(stravatoken.UsersCollection).Doc(strconv.FormatInt(athleteID, 10)).Collection(stravatoken.PrivateCollection).Doc(stravatoken.TokensDocument)
}
