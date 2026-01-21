// Package ports defines the outbound ports (interfaces) for the dispatcher service.
//
// This package follows the hexagonal architecture (ports and adapters) pattern:
//   - Ports are interfaces that define how the core domain interacts with external systems
//   - Adapters are concrete implementations of these interfaces (found in adapters/)
//
// The dispatcher service uses these ports:
//   - Publisher: publishes webhook events to a message queue (e.g., Pub/Sub)
//   - SecretProvider: retrieves webhook verification secrets (from file or environment)
//
// This separation allows the core logic to remain independent of infrastructure concerns,
// making it easier to test (via mocks in portstest/) and swap implementations.
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
type SecretProvider interface {
	GetSecrets() (string, int, error)
}
