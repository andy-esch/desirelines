// Package pubsub provides a Google Cloud Pub/Sub adapter for the dispatcher.
//
// This adapter implements [ports.Publisher] to publish Strava webhook events
// to a Pub/Sub topic for downstream processing, and [ports.RawPublisher] for
// topics whose consumer defines the wire format (see Message Format below).
//
// # Basic Usage
//
//	publisher, err := pubsub.NewPublisher(ctx, "my-project", "webhooks-topic", logger, histogram)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer publisher.Close(ctx)
//
//	err = publisher.Publish(ctx, webhookEvent, correlationID)
//
// # Validation
//
// [NewPublisher] validates GCP resource IDs at construction time:
//   - Project ID: 6-30 lowercase alphanumeric characters with hyphens
//   - Topic ID: 3-255 alphanumeric characters starting with a letter
//
// # Message Format
//
// Published messages contain:
//   - Data: JSON-serialized webhook event (with string enum values for compatibility)
//   - Attributes: correlation_id for request tracing
//
// [Publisher.PublishRaw] sends a body the caller has already serialized,
// leaving attributes, tracing and metrics identical. It exists for topics
// where the consumer, not this adapter, dictates the message format — the
// BigQuery subscription, which reads JSON matched against a table schema.
//
// # Timeouts
//
// If the caller's context has no deadline, a default timeout of 30 seconds
// is applied to prevent indefinite blocking. Use context.WithTimeout for
// custom timeouts:
//
//	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
//	defer cancel()
//	err := publisher.Publish(ctx, event, id)
//
// # Thread Safety
//
// [Publisher] is safe for concurrent use. Multiple goroutines may call
// Publish simultaneously. After Close is called, subsequent Publish calls
// return [ErrPublisherClosed].
//
// # Graceful Shutdown
//
// Always call Close to release resources:
//
//	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
//	defer cancel()
//	if err := publisher.Close(shutdownCtx); err != nil {
//	    log.Printf("shutdown error: %v", err)
//	}
package pubsub
