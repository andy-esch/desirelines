package otel

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// RecordDuration starts a timer and returns a callback to record the elapsed
// duration in milliseconds on the given histogram. The callback accepts an
// optional error — if non-nil, a "result=error" attribute is added; otherwise
// "result=success".
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
		elapsed := float64(time.Since(start).Milliseconds())
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
