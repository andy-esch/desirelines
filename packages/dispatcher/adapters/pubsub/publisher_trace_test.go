// Contract tests for the dispatcher's cross-service trace propagation.
//
// They catch the most likely break vector — "someone removes
// propagator.Inject from a publish path" — by asserting that Publish
// stamps a well-formed `traceparent` on the outgoing message. The
// downstream Python `extract_context_from_attributes` side is covered
// in `packages/stravapipe/tests/unit/shared/test_tracing.py`.
//
// Internal-test package (`package pubsub`, not `pubsub_test`) so we can
// construct a Publisher directly with the pstest-backed client without
// changing the public NewPublisher signature.

package pubsub

import (
	"context"
	"log/slog"
	"strings"
	"testing"

	pubsubv2 "cloud.google.com/go/pubsub/v2"
	pubsubpb "cloud.google.com/go/pubsub/v2/apiv1/pubsubpb"
	"cloud.google.com/go/pubsub/v2/pstest"
	otelglobal "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	generated "github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// newTestPublisher wires a Publisher to an in-process pstest server.
// Returns the publisher and the fake server so the test can inspect
// published messages. Cleanup is registered on t. Caller sets p.tracer
// after — keeps the helper's signature free of otel/trace imports.
func newTestPublisher(t *testing.T) (*Publisher, *pstest.Server) {
	t.Helper()
	srv := pstest.NewServer()
	t.Cleanup(func() {
		if err := srv.Close(); err != nil {
			t.Logf("pstest server Close: %v", err)
		}
	})

	conn, err := grpc.NewClient(srv.Addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("grpc.NewClient: %v", err)
	}
	t.Cleanup(func() {
		if cerr := conn.Close(); cerr != nil {
			t.Logf("grpc conn Close: %v", cerr)
		}
	})

	ctx := context.Background()
	client, err := pubsubv2.NewClient(ctx, "test-project", option.WithGRPCConn(conn))
	if err != nil {
		t.Fatalf("pubsub.NewClient: %v", err)
	}
	t.Cleanup(func() {
		if cerr := client.Close(); cerr != nil {
			t.Logf("pubsub client Close: %v", cerr)
		}
	})

	const topicName = "projects/test-project/topics/test-topic"

	// pstest auto-acks the Publish RPC but the v2 client checks topic
	// existence first, so create the topic in the fake before publishing.
	if _, topicErr := client.TopicAdminClient.CreateTopic(ctx, &pubsubpb.Topic{Name: topicName}); topicErr != nil {
		t.Fatalf("CreateTopic: %v", topicErr)
	}
	pub := client.Publisher(topicName)

	return &Publisher{
		client:    client,
		publisher: pub,
		logger:    slog.Default(),
		histogram: nil,
		tracer:    nil, // set by callers that need it
		topic:     "test-topic",
	}, srv
}

// withGlobalW3CPropagator installs propagation.TraceContext as the
// process-global text-map propagator for the duration of the test and
// restores whatever was there before. Mirrors the production composite
// propagator's W3C arm — that's the one that injects `traceparent` on
// outgoing PubSub messages. Global state, so we save/restore.
func withGlobalW3CPropagator(t *testing.T) {
	t.Helper()
	orig := otelglobal.GetTextMapPropagator()
	otelglobal.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { otelglobal.SetTextMapPropagator(orig) })
}

// TestPublish_InjectsTraceparentMatchingActiveSpan is the core
// cross-service propagation contract:
//
//	with an active OTel span, Publish must put a W3C `traceparent`
//	attribute on the outgoing PubSub message whose trace-id == the
//	active span's trace-id.
//
// If `otelglobal.GetTextMapPropagator().Inject(...)` is removed or
// the propagator chain stops including TraceContext, this fails.
func TestPublish_InjectsTraceparentMatchingActiveSpan(t *testing.T) {
	withGlobalW3CPropagator(t)

	provider := sdktrace.NewTracerProvider()
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Logf("tracer provider Shutdown: %v", err)
		}
	})
	tracer := provider.Tracer("test")

	p, srv := newTestPublisher(t)
	p.tracer = tracer

	ctx, span := tracer.Start(context.Background(), "test-parent-span")
	expectedTraceID := span.SpanContext().TraceID().String()

	err := p.Publish(ctx, &generated.EnrichedEvent{
		Event: &generated.WebhookEvent{ObjectId: 1, OwnerId: 2},
	}, "corr-id-test")
	span.End()
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}

	msgs := srv.Messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 published message, got %d", len(msgs))
	}

	traceparent, ok := msgs[0].Attributes["traceparent"]
	if !ok {
		t.Fatal("published message is missing `traceparent` attribute — regression in propagator.Inject?")
	}

	parts := strings.Split(traceparent, "-")
	if len(parts) != 4 {
		t.Fatalf("traceparent %q is malformed: expected 4 dash-separated fields", traceparent)
	}
	if parts[0] != "00" {
		t.Errorf("traceparent version = %q, want %q", parts[0], "00")
	}
	if parts[1] != expectedTraceID {
		t.Errorf("traceparent trace-id = %q, want %q (active span trace-id)", parts[1], expectedTraceID)
	}

	// Sanity: pre-existing contract — correlation_id is still on the message.
	if got := msgs[0].Attributes["correlation_id"]; got != "corr-id-test" {
		t.Errorf("correlation_id = %q, want %q", got, "corr-id-test")
	}
}

// TestPublish_NoCallerSpan_InjectsInternalSpanContext pins the contract
// that Publish always emits a well-formed `traceparent` on the outgoing
// message, even when the caller passes a bare `context.Background()` with
// no active span — because Publish opens its own internal `pubsub.publish`
// span before injecting, and that span's context is what gets propagated.
// Guards against the regression "someone refactors Publish to skip opening
// the internal span when the caller didn't provide one," which would
// silently drop downstream tracing for any call site that doesn't already
// have a parent span on the context.
func TestPublish_NoCallerSpan_InjectsInternalSpanContext(t *testing.T) {
	withGlobalW3CPropagator(t)

	provider := sdktrace.NewTracerProvider()
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Logf("tracer provider Shutdown: %v", err)
		}
	})

	p, srv := newTestPublisher(t)
	p.tracer = provider.Tracer("test")

	// context.Background() carries no caller span. Publish opens its own
	// internal `pubsub.publish` span before injecting, so the published
	// message's `traceparent` reflects THAT span's trace-id — not absence.
	err := p.Publish(context.Background(), &generated.EnrichedEvent{
		Event: &generated.WebhookEvent{ObjectId: 1, OwnerId: 2},
	}, "corr-id-no-span")
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}

	msgs := srv.Messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 published message, got %d", len(msgs))
	}

	traceparent, ok := msgs[0].Attributes["traceparent"]
	if !ok {
		t.Fatal("published message is missing `traceparent` even though Publish opens its own internal span")
	}
	parts := strings.Split(traceparent, "-")
	if len(parts) != 4 || parts[0] != "00" {
		t.Errorf("traceparent %q is malformed; want `00-<32hex>-<16hex>-<flags>`", traceparent)
	}
}
