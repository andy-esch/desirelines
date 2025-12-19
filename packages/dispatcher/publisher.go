package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/pubsub/v2"
)

// Publisher defines the interface for publishing webhook events.
type Publisher interface {
	Publish(ctx context.Context, webhook WebhookRequest, correlationID string) error
	// Close releases resources held by the publisher.
	// Useful for graceful shutdown.
	Close() error
}

// PubSubPublisher is a Pub/Sub adapter that implements the Publisher interface.
type PubSubPublisher struct {
	client    *pubsub.Client
	publisher *pubsub.Publisher
}

// NewPubSubPublisher creates a new Pub/Sub publisher.
func NewPubSubPublisher(ctx context.Context, projectID, topicID string) (*PubSubPublisher, error) {
	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create PubSub client: %w", err)
	}

	topicName := fmt.Sprintf("projects/%s/topics/%s", projectID, topicID)
	publisher := client.Publisher(topicName)
	DefaultLogger.Info("PubSub publisher initialized", "topic", topicName)

	return &PubSubPublisher{
		client:    client,
		publisher: publisher,
	}, nil
}

// Publish implements the Publisher interface.
func (p *PubSubPublisher) Publish(ctx context.Context, webhook WebhookRequest, correlationID string) error {
	data, err := json.Marshal(webhook)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook data: %w", err)
	}

	result := p.publisher.Publish(ctx, &pubsub.Message{
		Data: data,
		Attributes: map[string]string{
			"correlation_id": correlationID,
		},
	})

	// Get blocks until the message is published or an error occurs.
	_, err = result.Get(ctx)
	if err != nil {
		return fmt.Errorf("failed to publish to PubSub: %w", err)
	}

	DefaultLogger.Info("Successfully published webhook to PubSub",
		"correlation_id", correlationID,
		"object_id", webhook.ObjectID,
		"aspect_type", webhook.AspectType,
		"owner_id", webhook.OwnerID)
	return nil
}

// Close releases resources held by the PubSub client.
// This should be called when shutting down gracefully.
func (p *PubSubPublisher) Close() error {
	if p.client != nil {
		return p.client.Close()
	}
	return nil
}

// MockPublisher is a mock implementation of the Publisher interface for testing.
type MockPublisher struct {
	PublishErr error
	Published  []WebhookRequest
}

// Publish implements the mock publisher.
func (m *MockPublisher) Publish(ctx context.Context, webhook WebhookRequest, correlationID string) error {
	if m.PublishErr == nil {
		m.Published = append(m.Published, webhook)
	}
	return m.PublishErr
}

// Close implements the Publisher interface for MockPublisher.
// No-op for testing.
func (m *MockPublisher) Close() error {
	return nil
}
