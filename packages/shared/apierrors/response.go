package apierrors

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"go.opentelemetry.io/otel/trace"
)

// requestIDKey is the context key for storing a request ID.
type requestIDKey struct{}

// WithRequestID returns a new context carrying the given request ID.
// Use this to bridge framework-specific request ID middleware (e.g. chi)
// into a router-agnostic context value that WriteError can read.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestIDFromContext extracts the request ID from context.
// Returns empty string if none is set.
func RequestIDFromContext(ctx context.Context) string {
	id, ok := ctx.Value(requestIDKey{}).(string)
	if !ok {
		return ""
	}
	return id
}

// ErrorResponse is the JSON structure returned to clients for errors.
//
// TraceID is the raw hex trace ID of the active OpenTelemetry span (not the
// "projects/<p>/traces/<id>" resource-name form). Clients can paste it into
// a bug report so support can jump straight to the trace in Cloud Trace.
// Omitted when no OTel span is active on the request.
type ErrorResponse struct {
	Error     string         `json:"error"`
	Code      string         `json:"code,omitempty"`
	RequestID string         `json:"requestId,omitempty"`
	TraceID   string         `json:"traceId,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

// WriteError writes a standardized JSON error response and logs the error.
// The request ID is read from context via RequestIDFromContext, and the
// trace ID is read from the active OpenTelemetry span (if any).
func WriteError(w http.ResponseWriter, r *http.Request, err APIError, logger *slog.Logger) {
	requestID := RequestIDFromContext(r.Context())
	traceID := traceIDFromContext(r.Context())

	// Log error with context
	logAttrs := []any{
		"path", r.URL.Path,
		"method", r.Method,
		"status", err.Status,
		"request_id", requestID,
	}
	if err.Code != "" {
		logAttrs = append(logAttrs, "code", err.Code)
	}

	msg := err.LogMessage
	if msg == "" {
		msg = err.Message
	}

	if err.Status >= 500 {
		logger.Error("API Internal Error", append(logAttrs, "error", msg)...)
	} else {
		logger.Warn("API Request Error", append(logAttrs, "error", msg)...)
	}

	// Write JSON error response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.Status)

	response := ErrorResponse{
		Error:     err.Message,
		Code:      err.Code,
		RequestID: requestID,
		TraceID:   traceID,
	}
	if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
		logger.Error("Failed to encode error response", "error", encErr, "request_id", requestID)
	}
}

// traceIDFromContext returns the raw hex trace ID of the active OTel span,
// or empty string if no valid span is present. This is the raw 32-char hex
// form (not "projects/<p>/traces/<id>"), so clients can copy-paste cleanly
// into Cloud Trace search without stripping a GCP resource-name prefix.
func traceIDFromContext(ctx context.Context) string {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return ""
	}
	return sc.TraceID().String()
}
