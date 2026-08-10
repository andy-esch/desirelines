// Tests the Publish/Close drain contract: Close must wait for in-flight
// Publish calls to complete before tearing down the underlying gRPC
// client, otherwise messages in flight during a SIGTERM-driven shutdown
// can be lost without a clean error contract.
//
// Internal-test package so we can construct a Publisher directly with the
// pstest-backed client (same approach as publisher_trace_test.go).

package pubsub

import (
	"context"
	"errors"
	"testing"
	"time"

	pubsubpb "cloud.google.com/go/pubsub/v2/apiv1/pubsubpb"
	"go.opentelemetry.io/otel/trace/noop"

	generated "github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// TestPublisher_CloseDrainsInflightPublish gates a Publish on a manual
// server response, calls Close concurrently, and asserts Close does not
// return until the in-flight Publish completes. Without the WaitGroup
// drain, Close would tear down the gRPC client mid-publish and drop the
// message.
func TestPublisher_CloseDrainsInflightPublish(t *testing.T) {
	p, srv := newTestPublisher(t)
	p.tracer = noop.NewTracerProvider().Tracer("test")

	// Stop auto-acking so the Publish call blocks in result.Get(ctx)
	// until we explicitly enqueue a response.
	srv.SetAutoPublishResponse(false)
	srv.ResetPublishResponses(1)

	publishErr := make(chan error, 1)
	go func() {
		publishErr <- p.Publish(context.Background(), &generated.EnrichedEvent{
			Event: &generated.WebhookEvent{ObjectId: 1, OwnerId: 2},
		}, "drain-test")
	}()

	// Wait long enough for Publish to clear the closed-check and reach
	// result.Get(). 50ms is well over what pstest's setup needs and is
	// the same order of magnitude used elsewhere in the dispatcher tests.
	time.Sleep(50 * time.Millisecond)

	closeErr := make(chan error, 1)
	go func() {
		closeErr <- p.Close(context.Background())
	}()

	// Close must not return while Publish is still in flight.
	select {
	case err := <-closeErr:
		t.Fatalf("Close returned before in-flight Publish drained: err=%v", err)
	case <-publishErr:
		t.Fatal("Publish completed before we issued a server response — test setup invariant violated")
	case <-time.After(50 * time.Millisecond):
	}

	// Unblock Publish.
	srv.AddPublishResponse(&pubsubpb.PublishResponse{MessageIds: []string{"m1"}}, nil)

	select {
	case err := <-publishErr:
		if err != nil {
			t.Fatalf("Publish failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Publish did not complete after server response")
	}

	select {
	case err := <-closeErr:
		if err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return after in-flight Publish completed")
	}
}

// TestPublisher_CloseHonorsContextDeadlineDuringDrain pins the drain's upper
// bound. The drain above is unbounded on its own, so a publish wedged against
// a slow or unreachable Pub/Sub backend would block shutdown past Cloud Run's
// termination grace period and end in a SIGKILL. Close must instead give up on
// the drain when its context expires, tear the client down anyway, and report
// the truncated drain so the caller logs a dirty shutdown rather than a clean
// one.
// The in-flight publish is simulated by holding the WaitGroup directly rather
// than parking a real Publish against pstest. A publish parked in the fake
// server holds pstest's server mutex until a response is enqueued, which
// deadlocks the newTestPublisher cleanup's srv.Close() and hangs the whole
// package to its 10m test timeout. The WaitGroup is the actual subject here —
// Close's drain waits on it and nothing else — so holding it directly tests the
// bound exactly, deterministically, and in milliseconds.
func TestPublisher_CloseHonorsContextDeadlineDuringDrain(t *testing.T) {
	p, _ := newTestPublisher(t)
	p.tracer = noop.NewTracerProvider().Tracer("test")

	// Stand in for a Publish that cleared the closed-check and is parked in
	// result.Get. Released on return — before t.Cleanup runs — so the drain
	// goroutine Close spawned can finish and teardown is never blocked.
	p.inflight.Add(1)
	defer p.inflight.Done()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := p.Close(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Close returned nil, want an error reporting the truncated drain")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Close err = %v, want it to wrap context.DeadlineExceeded", err)
	}
	// The point of the bound: Close returns on the context's schedule, not the
	// publish's. Generous upper bound so this does not flake on a loaded runner.
	if elapsed > 5*time.Second {
		t.Fatalf("Close took %v with a 100ms deadline — the drain is not actually bounded", elapsed)
	}
}

// TestPublisher_PublishAfterCloseReturnsErrClosed pins the second half of
// the closed-check contract: once Close has started, new Publish calls
// must observe closed=true and return ErrPublisherClosed rather than
// incrementing the in-flight WaitGroup (which would deadlock Close.Wait).
func TestPublisher_PublishAfterCloseReturnsErrClosed(t *testing.T) {
	p, _ := newTestPublisher(t)
	p.tracer = noop.NewTracerProvider().Tracer("test")

	if err := p.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	err := p.Publish(context.Background(), &generated.EnrichedEvent{
		Event: &generated.WebhookEvent{ObjectId: 1, OwnerId: 2},
	}, "after-close")
	if !errors.Is(err, ErrPublisherClosed) {
		t.Fatalf("Publish after Close: err = %v, want ErrPublisherClosed", err)
	}
}
