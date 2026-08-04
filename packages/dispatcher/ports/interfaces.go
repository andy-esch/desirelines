package ports

import (
	"context"
	"errors"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Sentinel errors for port operations.
var (
	// ErrActivityNotFound is returned when a Strava activity does not exist.
	ErrActivityNotFound = errors.New("activity not found")
	// ErrTokenNotFound is returned when no Strava tokens exist for an athlete.
	ErrTokenNotFound = errors.New("token not found")
	// ErrStravaAuthFailed is returned when Strava permanently rejected the
	// athlete's credentials — a revoked, rotated or otherwise dead refresh
	// token. Deliberately distinct from a transient Strava failure: retrying
	// cannot resolve it, only the athlete re-authorizing can.
	ErrStravaAuthFailed = errors.New("strava authentication failed")
	// ErrTokenConflict is returned when a concurrent token refresh was detected.
	// The caller should re-read the tokens and retry with the winner's values.
	ErrTokenConflict = errors.New("token conflict: concurrent refresh detected")
)

// Publisher defines the outbound port for publishing enriched webhook events.
type Publisher interface {
	Publish(ctx context.Context, enriched *generated.EnrichedEvent, correlationID string) error
	// Close releases resources held by the publisher.
	// The context can be used to set a deadline for graceful shutdown.
	Close(ctx context.Context) error
}

// RawPublisher defines the outbound port for publishing a message the caller
// has already serialized. It exists for topics whose consumer defines the wire
// format — currently the BigQuery subscription, which reads JSON matched
// against the destination table's schema rather than the webhook envelope
// [Publisher] sends.
type RawPublisher interface {
	// PublishRaw sends data verbatim as the message body.
	PublishRaw(ctx context.Context, data []byte, correlationID string) error
	// Close releases resources held by the publisher.
	// The context can be used to set a deadline for graceful shutdown.
	Close(ctx context.Context) error
}

// SecretProvider defines the outbound port for retrieving webhook secrets.
// The subscription ID is returned as int32 to match the protobuf field type.
//
// GetSecrets returns both verifyToken and subscriptionID in a single call.
// The verification handler uses only verifyToken, and the event handler uses
// only subscriptionID. This coupling is intentional: both values come from
// the same secret file and share a TTL cache, so a single method keeps the
// interface simple. If the secret source is split in the future, consider
// splitting into VerifyTokenProvider and SubscriptionIDProvider.
type SecretProvider interface {
	GetSecrets() (verifyToken string, subscriptionID int32, err error)
}

// TokenStore defines the outbound port for reading and writing per-user Strava tokens.
type TokenStore interface {
	GetTokens(ctx context.Context, athleteID int64) (*stravatoken.Data, error)
	// WriteTokensIfUnmodified atomically writes tokens only if last_refreshed
	// matches expectedLastRefreshed. Returns ErrTokenConflict if another
	// goroutine has already refreshed the tokens (optimistic concurrency).
	WriteTokensIfUnmodified(ctx context.Context, athleteID int64, tokens *stravatoken.Data, expectedLastRefreshed time.Time) error
	// DeleteTokens removes all stored tokens for the given athlete.
	// Returns nil if the tokens do not exist (idempotent).
	DeleteTokens(ctx context.Context, athleteID int64) error
}

// TokenInvalidator is optionally implemented by a TokenStore that caches reads.
// It lets a caller drop a cached entry it has just learned is stale — most
// importantly the Strava client on a rejected refresh, where the poison would
// otherwise be re-served until the cache TTL lapses, and where a fresh token may
// already exist in Firestore (written out-of-process by the apigateway on
// re-auth, which this in-process cache cannot see). A non-caching TokenStore does
// not implement this, so callers type-assert and no-op when it's absent.
type TokenInvalidator interface {
	Invalidate(athleteID int64)
}

// StravaClient defines the outbound port for fetching activity data from the Strava API.
type StravaClient interface {
	// FetchActivity retrieves the raw JSON for a Strava activity by ID,
	// using tokens for the given owner (athlete).
	FetchActivity(ctx context.Context, ownerID, activityID int64) ([]byte, error)
}
