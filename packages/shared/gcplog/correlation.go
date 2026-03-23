package gcplog

import "context"

type correlationKeyType struct{}

var correlationKey correlationKeyType

// WithCorrelationID returns a new context carrying the given correlation ID.
func WithCorrelationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, correlationKey, id)
}

// CorrelationIDFromContext extracts the correlation ID from context.
// Returns empty string if none is set.
func CorrelationIDFromContext(ctx context.Context) string {
	id, ok := ctx.Value(correlationKey).(string)
	if !ok {
		return ""
	}
	return id
}
