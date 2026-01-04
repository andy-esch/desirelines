// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"encoding/json"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

// RespondJSON writes a JSON response with CORS headers.
func RespondJSON(w http.ResponseWriter, r *http.Request, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		logger.Logger.Error("Error encoding JSON response", "error", err)
	}
}

// RespondRawJSON writes raw JSON bytes with CORS headers.
// Use this for pre-marshaled JSON data to avoid double encoding.
func RespondRawJSON(w http.ResponseWriter, r *http.Request, status int, data []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if _, err := w.Write(data); err != nil {
		logger.Logger.Error("Error writing raw JSON response", "error", err)
	}
}
