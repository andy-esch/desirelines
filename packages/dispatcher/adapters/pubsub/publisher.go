// Package pubsub provides a Google Cloud Pub/Sub adapter for the dispatcher.
package pubsub

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
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

var (
	// ErrPublisherClosed is returned when Publish is called on a closed publisher.
	ErrPublisherClosed = errors.New("publisher is closed")

	// ErrPublisherNotInitialized is returned when publisher is nil.
	ErrPublisherNotInitialized = errors.New("publisher not initialized")

	// projectIDRegex validates GCP project ID format.
	// Project IDs must be 6-30 characters: lowercase letters, digits, hyphens.
	// Must start with a letter and cannot end with a hyphen.
	projectIDRegex = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)

	// topicIDRegex validates Pub/Sub topic ID format.
	// Topic IDs must be 3-255 characters: letters, digits, hyphens, underscores, periods, tildes, plus, percent.
	// Must start with a letter.
	topicIDRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9-_.~+%]{2,254}$`)
)

// Publisher is a Pub/Sub adapter that implements the repository.Publisher interface.
type Publisher struct {
	client    *pubsub.Client
	publisher *pubsub.Publisher
	logger    *slog.Logger

	mu     sync.RWMutex
	closed bool
}

// NewPublisher creates a new Pub/Sub publisher adapter.
// Returns an error if projectID or topicID have invalid format.
func NewPublisher(ctx context.Context, projectID, topicID string, logger *slog.Logger) (*Publisher, error) {
	// Validate project ID format
	if projectID == "" {
		return nil, errors.New("projectID is required")
	}
	if !projectIDRegex.MatchString(projectID) {
		return nil, fmt.Errorf("invalid projectID format: %q (must be 6-30 lowercase alphanumeric characters with hyphens)", projectID)
	}

	// Validate topic ID format
	if topicID == "" {
		return nil, errors.New("topicID is required")
	}
	if !topicIDRegex.MatchString(topicID) {
		return nil, fmt.Errorf("invalid topicID format: %q (must be 3-255 alphanumeric characters starting with a letter)", topicID)
	}

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
// Returns ErrPublisherNotInitialized if the publisher was not properly initialized.
// If the context has no deadline, a default timeout of 30s is applied.
func (p *Publisher) Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return ErrPublisherClosed
	}
	if p.publisher == nil {
		p.mu.RUnlock()
		return ErrPublisherNotInitialized
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
