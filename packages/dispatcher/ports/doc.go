// Package ports defines the outbound ports (interfaces) for the dispatcher service.
//
// This package follows the hexagonal architecture (ports and adapters) pattern:
//   - Ports are interfaces that define how the core domain interacts with external systems
//   - Adapters are concrete implementations of these interfaces (found in adapters/)
//
// # Interfaces
//
// The dispatcher service defines two ports:
//
// [Publisher] publishes webhook events to a message queue. The production
// implementation uses Google Cloud Pub/Sub (see adapters/pubsub).
//
// [SecretProvider] retrieves webhook verification secrets for validating
// incoming Strava webhooks. The production implementation reads from
// a mounted secrets file (see adapters/env).
//
// # Testing
//
// The portstest subpackage provides mock implementations for testing:
//
//	import "github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
//
//	publisher := &portstest.MockPublisher{}
//	secretProvider := &portstest.MockSecretProvider{
//	    VerifyToken:    "test-token",
//	    SubscriptionID: 12345,
//	}
//
// # Implementing Custom Adapters
//
// To implement a custom adapter, satisfy the interface:
//
//	type MyPublisher struct { ... }
//
//	func (p *MyPublisher) Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error {
//	    // Your implementation
//	}
//
//	func (p *MyPublisher) Close(ctx context.Context) error {
//	    // Cleanup resources
//	}
package ports
