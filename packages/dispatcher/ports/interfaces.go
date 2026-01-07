// Package ports defines the outbound ports (interfaces) for the dispatcher service.
package ports

import (
	"context"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// Publisher defines the outbound port for publishing webhook events.
type Publisher interface {
	Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error
	Close() error
}

// SecretProvider defines the outbound port for retrieving webhook secrets.
type SecretProvider interface {
	GetSecrets() (string, int, error)
}
