package pubsub

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"sync"
	"time"

	"cloud.google.com/go/pubsub/v2"
	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	otelglobal "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const (
	// DefaultPublishTimeout is the maximum time to wait for a publish operation
	// if the caller's context has no deadline. Prevents indefinite blocking.
	DefaultPublishTimeout = 30 * time.Second
)

// receivedAtCtxKey carries the dispatcher-receive timestamp from the HTTP
// handler down to the publisher so it can be stamped onto the Pub/Sub
// message attributes. Downstream postgres-writer subtracts this from its
// insert time to record the end-to-end webhook freshness histogram that
// SLO 3 (data freshness) measures. Unexported; use WithWebhookReceivedAt
// and webhookReceivedAt to read/write.
type receivedAtCtxKey struct{}

// WithWebhookReceivedAt stashes the dispatcher's webhook-receive timestamp
// on the context. Call this once at HTTP handler entry; the publisher will
// read it when stamping Pub/Sub attributes.
func WithWebhookReceivedAt(ctx context.Context, t time.Time) context.Context {
	return context.WithValue(ctx, receivedAtCtxKey{}, t)
}

// webhookReceivedAt returns the receive timestamp stashed via
// WithWebhookReceivedAt. The bool is false when no timestamp was set, in
// which case the publisher SHOULD NOT stamp the attribute — postgres-writer
// then correctly skips the freshness histogram emission rather than
// recording a near-zero value that would falsely make SLO 3 look healthy.
func webhookReceivedAt(ctx context.Context) (time.Time, bool) {
	t, ok := ctx.Value(receivedAtCtxKey{}).(time.Time)
	return t, ok
}

var (
	// ErrPublisherClosed is returned when Publish is called on a closed publisher.
	ErrPublisherClosed = errors.New("publisher is closed")

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
	histogram metric.Float64Histogram
	tracer    trace.Tracer
	// topic is the Pub/Sub topic ID, stamped on the publish span as the
	// OTel messaging.destination.name semconv attribute.
	topic string

	mu     sync.RWMutex
	closed bool
	// inflight tracks Publish calls past the closed check so Close can
	// drain them before tearing down the underlying gRPC client.
	inflight sync.WaitGroup
}

// ValidateProjectID checks that a GCP project ID matches the required format.
func ValidateProjectID(projectID string) error {
	if projectID == "" {
		return errors.New("projectID is required")
	}
	if !projectIDRegex.MatchString(projectID) {
		return fmt.Errorf("invalid projectID format: %q (must be 6-30 lowercase alphanumeric characters with hyphens)", projectID)
	}
	return nil
}

// ValidateTopicID checks that a Pub/Sub topic ID matches the required format.
func ValidateTopicID(topicID string) error {
	if topicID == "" {
		return errors.New("topicID is required")
	}
	if !topicIDRegex.MatchString(topicID) {
		return fmt.Errorf("invalid topicID format: %q (must be 3-255 alphanumeric characters starting with a letter)", topicID)
	}
	return nil
}

// NewPublisher creates a new Pub/Sub publisher adapter.
// Returns an error if projectID or topicID have invalid format.
// The histogram parameter is optional — pass nil to disable duration recording.
func NewPublisher(ctx context.Context, projectID, topicID string, logger *slog.Logger, histogram metric.Float64Histogram, tracer trace.Tracer) (*Publisher, error) {
	if err := ValidateProjectID(projectID); err != nil {
		return nil, err
	}
	if err := ValidateTopicID(topicID); err != nil {
		return nil, err
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
		histogram: histogram,
		tracer:    tracer,
		topic:     topicID,
	}, nil
}

// Publish sends an enriched webhook event to the configured Pub/Sub topic.
// Returns ErrPublisherClosed if called after Close.
// If the context has no deadline, a default timeout of 30s is applied.
func (p *Publisher) Publish(ctx context.Context, enriched *generated.EnrichedEvent, correlationID string) (err error) {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return ErrPublisherClosed
	}
	p.inflight.Add(1)
	p.mu.RUnlock()
	defer p.inflight.Done()

	// Ensure context has a deadline to prevent indefinite blocking
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultPublishTimeout)
		defer cancel()
	}

	ctx, spanDone := otel.StartSpan(ctx, p.tracer, "pubsub.publish",
		attribute.String("correlation_id", correlationID),
		attribute.String("messaging.system", "gcp_pubsub"),
		attribute.String("messaging.destination.name", p.topic),
		attribute.String("messaging.operation", "publish"),
	)
	defer func() { spanDone(err) }()

	// Use ToEnrichedJSON to serialize with string enums ("create", "activity")
	// and include raw_activity as a nested JSON object.
	data, err := webhookproto.ToEnrichedJSON(enriched)
	if err != nil {
		return fmt.Errorf("failed to marshal enriched event: %w", err)
	}

	// Inject W3C traceparent into message attributes so downstream Python
	// consumers can continue the distributed trace. Also stamp the
	// dispatcher-receive timestamp (Unix milliseconds) when set on
	// context — postgres-writer reads this to record the end-to-end
	// webhook freshness histogram (`webhook/end_to_end.duration`),
	// which SLO 3 (data freshness) measures against. Skipping the
	// attribute when no timestamp was stashed is intentional: it lets
	// postgres-writer drop the measurement rather than emit a falsely
	// short duration.
	attrs := map[string]string{
		"correlation_id": correlationID,
	}
	if t, ok := webhookReceivedAt(ctx); ok {
		attrs["dispatcher_received_at_unix_ms"] = strconv.FormatInt(t.UnixMilli(), 10)
	}
	otelglobal.GetTextMapPropagator().Inject(ctx, propagation.MapCarrier(attrs))

	result := p.publisher.Publish(ctx, &pubsub.Message{
		Data:       data,
		Attributes: attrs,
	})

	// Get blocks until the message is published or context is canceled.
	done := otel.RecordDuration(ctx, p.histogram)
	id, err := result.Get(ctx)
	done(err)
	if err != nil {
		return fmt.Errorf("failed to publish to PubSub: %w", err)
	}

	webhook := enriched.Event
	p.logger.Info("Successfully published enriched event to PubSub",
		"message_id", id,
		"correlation_id", correlationID,
		"object_id", webhook.ObjectId,
		"aspect_type", webhookproto.AspectTypeToString(webhook.AspectType),
		"owner_id", webhook.OwnerId,
		"has_raw_activity", enriched.RawActivity != nil)
	return nil
}

// Close releases resources held by the PubSub client. It blocks until all
// in-flight Publish calls return so the underlying gRPC client is not torn
// down mid-publish (which would drop messages on SIGTERM-driven shutdown).
// After Close returns, subsequent Publish calls will return ErrPublisherClosed.
// The context parameter is accepted for interface compatibility but is not used,
// as the underlying PubSub client.Close() does not support context cancellation.
func (p *Publisher) Close(_ context.Context) error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	p.mu.Unlock()

	// Wait for in-flight Publish calls to finish before closing the
	// underlying gRPC client. Subsequent Publish calls observe closed=true
	// under the read lock and return ErrPublisherClosed without incrementing
	// the WaitGroup, so this drain terminates.
	p.inflight.Wait()

	if p.client == nil {
		return nil
	}

	err := p.client.Close()
	p.client = nil
	if err != nil {
		return fmt.Errorf("close pubsub client: %w", err)
	}
	return nil
}
