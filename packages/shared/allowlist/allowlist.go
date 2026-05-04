// Package allowlist provides shared interfaces and Firestore-backed
// implementations for athlete-allowlist enforcement across services.
//
// The apigateway uses Checker during the OAuth callback to gate token
// storage. The dispatcher uses it to drop stray webhook events for athletes
// who hold a Strava OAuth grant but are not allowlisted in this environment.
package allowlist

import (
	"context"
	"fmt"
	"log/slog"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

// Checker verifies whether an athlete is permitted to use this environment.
// Implementations must return (false, nil) for "definitely not allowed" and
// only return a non-nil error for transient failures (e.g., backend
// unreachable). Callers fail-closed on errors.
type Checker interface {
	IsAllowed(ctx context.Context, athleteID string) (bool, error)
}

// FirestoreChecker is the Firestore-backed implementation of Checker.
// It looks up documents in stravatoken.AllowlistCollection by athlete ID.
type FirestoreChecker struct {
	client *firestore.Client
	logger *slog.Logger
}

// Compile-time check.
var _ Checker = (*FirestoreChecker)(nil)

// NewFirestoreChecker creates a new Firestore-backed allowlist checker.
func NewFirestoreChecker(client *firestore.Client, logger *slog.Logger) *FirestoreChecker {
	return &FirestoreChecker{client: client, logger: logger}
}

// IsAllowed returns true iff a document exists at
// {AllowlistCollection}/{athleteID}. NotFound is mapped to (false, nil);
// any other Firestore error is wrapped and returned.
func (c *FirestoreChecker) IsAllowed(ctx context.Context, athleteID string) (bool, error) {
	_, err := c.client.Collection(stravatoken.AllowlistCollection).Doc(athleteID).Get(ctx)
	if err != nil {
		if grpcstatus.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, fmt.Errorf("check allowlist for %s: %w", athleteID, err)
	}
	return true, nil
}
