// Package pubsub provides a Google Cloud Pub/Sub adapter for the dispatcher.
package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"cloud.google.com/go/pubsub/v2"
	"github.com/andy-esch/desirelines/packages/dispatcher/domain"
)

// Publisher is a Pub/Sub adapter that implements the repository.Publisher interface.
type Publisher struct {
	client    *pubsub.Client
	publisher *pubsub.Publisher
	logger    *slog.Logger
}

// NewPublisher creates a new Pub/Sub publisher adapter.
func NewPublisher(ctx context.Context, projectID, topicID string, logger *slog.Logger) (*Publisher, error) {
	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create PubSub client: %w", err)
	}

	topicName := fmt.Sprintf("projects/%s/topics/%s", projectID, topicID)
	publisher := client.Publisher(topicName)
	logger.Info("PubSub publisher initialized", "topic", topicName)

	return &Publisher{
		client:    client,
		publisher: publisher,
		logger:    logger,
	}, nil
}

// Publish sends a webhook event to the configured Pub/Sub topic.
func (p *Publisher) Publish(ctx context.Context, webhook domain.WebhookRequest, correlationID string) error {
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
	id, err := result.Get(ctx)
	if err != nil {
		return fmt.Errorf("failed to publish to PubSub: %w", err)
	}

	p.logger.Info("Successfully published webhook to PubSub",
		"message_id", id,
		"correlation_id", correlationID,
		"object_id", webhook.ObjectID,
		"aspect_type", webhook.AspectType,
		"owner_id", webhook.OwnerID)
	return nil
}

// Close releases resources held by the PubSub client.
func (p *Publisher) Close() error {
	if p.client != nil {
		return p.client.Close()
	}
	return nil
}
