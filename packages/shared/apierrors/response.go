package apierrors

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
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
type ErrorResponse struct {
	Error     string         `json:"error"`
	Code      string         `json:"code,omitempty"`
	RequestID string         `json:"request_id,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

// WriteError writes a standardized JSON error response and logs the error.
// The request ID is read from context via RequestIDFromContext.
func WriteError(w http.ResponseWriter, r *http.Request, err APIError, logger *slog.Logger) {
	requestID := RequestIDFromContext(r.Context())

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
	}
	if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
		logger.Error("Failed to encode error response", "error", encErr, "request_id", requestID)
	}
}
