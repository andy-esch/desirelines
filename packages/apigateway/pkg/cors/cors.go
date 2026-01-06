// Package cors provides CORS (Cross-Origin Resource Sharing) handling for the API Gateway.
package cors

import (
	"log/slog"
	"net/http"
)

// Handler manages CORS configuration and header setting.
type Handler struct {
	allowedOrigins []string
	logger         *slog.Logger
}

// NewHandler creates a new CORS handler with provided origins and logger.
func NewHandler(allowedOrigins []string, logger *slog.Logger) *Handler {
	if len(allowedOrigins) == 0 {
		logger.Warn("CORS: ALLOWED_ORIGINS not set (or empty), blocking all cross-origin requests")
	} else {
		logger.Info("CORS: Configured allowed origins", "count", len(allowedOrigins))
	}

	return &Handler{
		allowedOrigins: allowedOrigins,
		logger:         logger,
	}
}

// SetHeaders sets appropriate CORS headers if the request origin is allowed.
// Returns true if origin was allowed, false otherwise.
func (h *Handler) SetHeaders(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")

	// No origin header means same-origin request or non-browser client
	if origin == "" {
		return true
	}

	// Check if origin is in allowlist
	for _, allowed := range h.allowedOrigins {
		if origin == allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			return true
		}
	}

	// Origin not allowed
	h.logger.Warn("CORS: Origin not allowed",
		"origin", origin,
		"allowed_origins", h.allowedOrigins)
	return false
}

// HandlePreflight responds to CORS preflight (OPTIONS) requests.
func (h *Handler) HandlePreflight(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers if origin is allowed
	h.SetHeaders(w, r)

	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Max-Age", "3600")
	w.WriteHeader(http.StatusNoContent)
}
