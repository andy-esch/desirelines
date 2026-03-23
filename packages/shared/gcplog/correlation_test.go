package gcplog

import (
	"context"
	"testing"
)

func TestCorrelationIDRoundTrip(t *testing.T) {
	ctx := context.Background()
	ctx = WithCorrelationID(ctx, "abc-123")

	got := CorrelationIDFromContext(ctx)
	if got != "abc-123" {
		t.Errorf("CorrelationIDFromContext = %q, want %q", got, "abc-123")
	}
}

func TestCorrelationIDFromContext_Empty(t *testing.T) {
	got := CorrelationIDFromContext(context.Background())
	if got != "" {
		t.Errorf("CorrelationIDFromContext on empty ctx = %q, want %q", got, "")
	}
}
