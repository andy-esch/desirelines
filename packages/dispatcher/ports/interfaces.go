package ports

import (
	"context"
	"errors"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Sentinel errors for port operations.
var (
	// ErrActivityNotFound is returned when a Strava activity does not exist.
	ErrActivityNotFound = errors.New("activity not found")
	// ErrTokenNotFound is returned when no Strava tokens exist for an athlete.
	ErrTokenNotFound = errors.New("token not found")
)

// Publisher defines the outbound port for publishing enriched webhook events.
type Publisher interface {
	Publish(ctx context.Context, enriched *generated.EnrichedEvent, correlationID string) error
	// Close releases resources held by the publisher.
	// The context can be used to set a deadline for graceful shutdown.
	Close(ctx context.Context) error
}

// SecretProvider defines the outbound port for retrieving webhook secrets.
// The subscription ID is returned as int32 to match the protobuf field type.
type SecretProvider interface {
	GetSecrets() (verifyToken string, subscriptionID int32, err error)
}

// TokenStore defines the outbound port for reading and writing per-user Strava tokens.
type TokenStore interface {
	GetTokens(ctx context.Context, athleteID int64) (*stravatoken.StravaTokenData, error)
	WriteTokens(ctx context.Context, athleteID int64, tokens *stravatoken.StravaTokenData) error
}

// StravaClient defines the outbound port for fetching activity data from the Strava API.
type StravaClient interface {
	// FetchActivity retrieves the raw JSON for a Strava activity by ID,
	// using tokens for the given owner (athlete).
	FetchActivity(ctx context.Context, ownerID, activityID int64) ([]byte, error)
}
