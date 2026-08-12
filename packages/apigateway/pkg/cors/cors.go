package cors

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Handler manages CORS configuration and header setting.
type Handler struct {
	allowedOrigins map[string]bool // O(1) lookup for origin validation
	logger         *slog.Logger
}

// NewHandler creates a new CORS handler with provided origins and logger.
//
// In strict mode (any non-local environment), passing an empty
// allowedOrigins list returns an error so the deploy fails fast rather
// than silently rejecting every cross-origin request. In lax mode
// (local dev), an empty list is permitted and logged at WARN — backend
// -only testing with curl still works.
func NewHandler(allowedOrigins []string, logger *slog.Logger, strict bool) (*Handler, error) {
	if len(allowedOrigins) == 0 {
		if strict {
			return nil, fmt.Errorf("ALLOWED_ORIGINS must be set in strict (non-local) mode")
		}
		logger.Warn("CORS: ALLOWED_ORIGINS not set (or empty), blocking all cross-origin requests")
	} else {
		logger.Info("CORS: Configured allowed origins", "count", len(allowedOrigins))
	}

	// Pre-compute map for O(1) origin lookups
	originMap := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if err := validateOrigin(origin); err != nil {
			return nil, fmt.Errorf("invalid CORS origin %q: %w", origin, err)
		}
		originMap[origin] = true
	}

	return &Handler{
		allowedOrigins: originMap,
		logger:         logger,
	}, nil
}

// validateOrigin rejects entries that a browser can never send as a serialized
// Origin or that would weaken the deployment accidentally. HTTPS is required
// except for loopback development origins; paths, credentials, queries,
// fragments, wildcard, and opaque/null origins are never valid allowlist keys.
func validateOrigin(origin string) error {
	if origin == "" || origin == "*" || origin == "null" {
		return fmt.Errorf("must be an explicit HTTP(S) origin")
	}
	u, err := url.ParseRequestURI(origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("must contain only scheme and host")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme != "http" {
		return fmt.Errorf("scheme must be HTTPS (or HTTP for loopback development)")
	}
	hostname := u.Hostname()
	if strings.EqualFold(hostname, "localhost") {
		return nil
	}
	if ip := net.ParseIP(hostname); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("plaintext HTTP is allowed only for loopback origins")
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
		// Expose backend trace id (set by otel.TraceIDResponseHeader) so the
		// browser can read it cross-origin via response.headers.get(). Without
		// this, the header reaches the browser but is hidden from JS.
		w.Header().Set("Access-Control-Expose-Headers", "X-Trace-Id")
		w.Header().Add("Vary", "Origin")
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
		// traceparent/tracestate/baggage allow the browser to propagate W3C
		// trace context for browser→apigateway correlation. apigateway is
		// public-endpoint-mode (main.go) so it *links*, never parents, on
		// these — they are correlation hints, not trusted parents. tracestate
		// and baggage are unused today but included to keep this a one-time
		// CORS change.
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, traceparent, tracestate, baggage")
		w.Header().Set("Access-Control-Max-Age", "3600")
	}
	w.WriteHeader(http.StatusNoContent)
}
