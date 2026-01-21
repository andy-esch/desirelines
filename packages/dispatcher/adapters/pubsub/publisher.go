// Package pubsub provides a Google Cloud Pub/Sub adapter for the dispatcher.
package pubsub

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"cloud.google.com/go/pubsub/v2"
	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

const (
	// DefaultPublishTimeout is the maximum time to wait for a publish operation
	// if the caller's context has no deadline. Prevents indefinite blocking.
	DefaultPublishTimeout = 30 * time.Second
)

// ErrPublisherClosed is returned when Publish is called on a closed publisher.
var ErrPublisherClosed = errors.New("publisher is closed")

// Publisher is a Pub/Sub adapter that implements the repository.Publisher interface.
type Publisher struct {
	client    *pubsub.Client
	publisher *pubsub.Publisher
	logger    *slog.Logger

	mu     sync.RWMutex
	closed bool
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
// Returns ErrPublisherClosed if called after Close.
// If the context has no deadline, a default timeout of 30s is applied.
func (p *Publisher) Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return ErrPublisherClosed
	}
	p.mu.RUnlock()

	// Ensure context has a deadline to prevent indefinite blocking
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultPublishTimeout)
		defer cancel()
	}

	// Use ToStravaJSON to serialize with string enums ("create", "activity")
	// instead of protojson which outputs numeric enums (1, 1).
	// This maintains compatibility with stravapipe's Pydantic WebhookRequest model.
	data, err := webhookproto.ToStravaJSON(webhook)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook data: %w", err)
	}

	result := p.publisher.Publish(ctx, &pubsub.Message{
		Data: data,
		Attributes: map[string]string{
			"correlation_id": correlationID,
		},
	})

	// Get blocks until the message is published or context is canceled.
	id, err := result.Get(ctx)
	if err != nil {
		return fmt.Errorf("failed to publish to PubSub: %w", err)
	}

	p.logger.Info("Successfully published webhook to PubSub",
		"message_id", id,
		"correlation_id", correlationID,
		"object_id", webhook.ObjectId,
		"aspect_type", webhookproto.AspectTypeToString(webhook.AspectType),
		"owner_id", webhook.OwnerId)
	return nil
}

// Close releases resources held by the PubSub client.
// The context can be used to set a deadline for the close operation.
// After Close returns, subsequent Publish calls will return ErrPublisherClosed.
func (p *Publisher) Close(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil // Already closed
	}
	p.closed = true

	if p.client == nil {
		return nil
	}

	// Create a channel to signal completion
	done := make(chan error, 1)
	go func() {
		done <- p.client.Close()
	}()

	// Wait for close or context cancellation
	select {
	case err := <-done:
		p.client = nil
		return err
	case <-ctx.Done():
		// Context canceled/timed out, but close is still in progress
		// We've marked as closed, so new publishes will fail
		return ctx.Err()
	}
}
