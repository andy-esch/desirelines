package otel

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// RecordDuration starts a timer and returns a callback to record the elapsed
// duration in milliseconds on the given histogram. The callback accepts an
// optional error — if non-nil, a "result=error" attribute is added; otherwise
// "result=success".
//
// Pass an "operation" attribute to split the histogram per logical
// operation. This restates what the enclosing span's name already says,
// but the two live on different planes: the metric label is what the
// latency alerts group P99 by (`sum by (le, metric_operation)` in
// alerts.tf). Keep it — dropping it silently collapses per-operation
// latency into one undifferentiated figure.
//
// Usage:
//
//	done := otel.RecordDuration(ctx, histogram, attribute.String("operation", "get_tokens"))
//	result, err := store.GetTokens(ctx, id)
//	done(err)
func RecordDuration(ctx context.Context, h metric.Float64Histogram, attrs ...attribute.KeyValue) func(error) {
	if h == nil {
		return func(error) {}
	}
	start := time.Now()
	return func(err error) {
		// Microseconds()/1000 rather than Milliseconds(): the latter truncates to
		// whole milliseconds, which floors every sub-ms operation to 0 and collapses
		// its histogram into a spike at zero.
		elapsed := float64(time.Since(start).Microseconds()) / 1000.0
		result := "success"
		if err != nil {
			result = "error"
		}
		all := make([]attribute.KeyValue, 0, len(attrs)+1)
		all = append(all, attrs...)
		all = append(all, attribute.String("result", result))
		h.Record(ctx, elapsed, metric.WithAttributes(all...))
	}
}

// StartSpan creates a span and returns the enriched context plus a done callback
// that ends the span. If err is non-nil, the span records the error and sets
// error status. Mirrors the RecordDuration ergonomics.
//
// Usage:
//
//	ctx, done := otel.StartSpan(ctx, tracer, "firestore.get_tokens",
//	    attribute.Int64("athlete_id", id))
//	result, err := store.GetTokens(ctx, id)
//	done(err)
func StartSpan(ctx context.Context, t trace.Tracer, name string, attrs ...attribute.KeyValue) (context.Context, func(error)) {
	ctx, span := t.Start(ctx, name, trace.WithAttributes(attrs...))
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}
