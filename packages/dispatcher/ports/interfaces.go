package ports

import (
	"context"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// Publisher defines the outbound port for publishing webhook events.
type Publisher interface {
	Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error
	// Close releases resources held by the publisher.
	// The context can be used to set a deadline for graceful shutdown.
	Close(ctx context.Context) error
}

// SecretProvider defines the outbound port for retrieving webhook secrets.
// The subscription ID is returned as int32 to match the protobuf field type.
type SecretProvider interface {
	GetSecrets() (verifyToken string, subscriptionID int32, err error)
}
