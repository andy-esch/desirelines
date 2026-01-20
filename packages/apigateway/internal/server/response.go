// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
)

// RespondJSON writes a JSON response with CORS headers.
// JSON is encoded to a buffer first to detect encoding errors before sending headers.
// This prevents partial responses with 200 OK status when encoding fails.
func RespondJSON(w http.ResponseWriter, r *http.Request, status int, data any, logger *slog.Logger) {
	// Buffer the JSON to detect encoding errors before writing headers
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(data); err != nil {
		logger.Error("Error encoding JSON response", "error", err, "data_type", logType(data))
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if _, err := w.Write(buf.Bytes()); err != nil {
		// At this point headers are sent; log but can't change response
		logger.Error("Error writing JSON response body", "error", err)
	}
}

// RespondRawJSON writes raw JSON bytes with CORS headers.
// Use this for pre-marshaled JSON data to avoid double encoding.
func RespondRawJSON(w http.ResponseWriter, r *http.Request, status int, data []byte, logger *slog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if _, err := w.Write(data); err != nil {
		logger.Error("Error writing raw JSON response", "error", err)
	}
}

// logType returns a string representation of the type for logging.
// Helps diagnose which types cause encoding failures.
func logType(v any) string {
	if v == nil {
		return "nil"
	}
	return fmt.Sprintf("%T", v)
}
