// Package cors provides CORS (Cross-Origin Resource Sharing) handling for the API Gateway.
package cors

import (
	"log/slog"
	"net/http"
)

// Handler manages CORS configuration and header setting.
type Handler struct {
	allowedOrigins map[string]bool // O(1) lookup for origin validation
	logger         *slog.Logger
}

// NewHandler creates a new CORS handler with provided origins and logger.
func NewHandler(allowedOrigins []string, logger *slog.Logger) *Handler {
	if len(allowedOrigins) == 0 {
		logger.Warn("CORS: ALLOWED_ORIGINS not set (or empty), blocking all cross-origin requests")
	} else {
		logger.Info("CORS: Configured allowed origins", "count", len(allowedOrigins))
	}

	// Pre-compute map for O(1) origin lookups
	originMap := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		originMap[origin] = true
	}

	return &Handler{
		allowedOrigins: originMap,
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

	// Check if origin is in allowlist (O(1) map lookup)
	if h.allowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		return true
	}

	// Origin not allowed
	h.logger.Warn("CORS: Origin not allowed", "origin", origin)
	return false
}

// HandlePreflight responds to CORS preflight (OPTIONS) requests.
// Only sets CORS method/header/cache headers if the origin is allowed.
func (h *Handler) HandlePreflight(w http.ResponseWriter, r *http.Request) {
	// Only set preflight headers if origin is allowed
	if h.SetHeaders(w, r) {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "3600")
	}
	w.WriteHeader(http.StatusNoContent)
}
