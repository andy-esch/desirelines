// Package health provides the liveness and readiness endpoint handlers.
//
// HandleLive serves /api/health: a cheap process-alive check with no
// dependency probes. Cloud Run's container probe and the GCP uptime check
// hit this path.
//
// HandleReady serves /api/ready: pings the database via the Pinger interface
// and returns 503 if the DB is unreachable. Cloud Scheduler hits this path
// hourly. Splitting it out keeps the high-frequency liveness path off Neon's
// compute meter — see split-apigateway-health-and-readiness-endpoints.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
)

const (
	// StatusHealthy indicates the service or component is functioning normally.
	StatusHealthy = "healthy"
	// StatusUnhealthy indicates the service or component has issues.
	StatusUnhealthy = "unhealthy"

	// DefaultHealthCheckTimeout is the default timeout for database health checks.
	DefaultHealthCheckTimeout = 2 * time.Second
)

// Pinger is a minimal interface for health checking database connectivity.
// This follows the Interface Segregation Principle - the health handler only
// needs Ping(), not the full ActivityRepository interface. Any type with a
// Ping method (including repository.ActivityRepository) satisfies this interface.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Response is the JSON structure returned by the health endpoint.
type Response struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

// Handler holds dependencies for the health check handler.
type Handler struct {
	pinger  Pinger
	logger  *slog.Logger
	timeout time.Duration
}

// NewHandler creates a new health check handler with default timeout.
// The pinger parameter can be nil if no database is configured, or any type
// that implements Ping() (e.g., repository.ActivityRepository).
func NewHandler(pinger Pinger, logger *slog.Logger) *Handler {
	return NewHandlerWithTimeout(pinger, logger, DefaultHealthCheckTimeout)
}

// NewHandlerWithTimeout creates a new health check handler with custom timeout.
func NewHandlerWithTimeout(pinger Pinger, logger *slog.Logger, timeout time.Duration) *Handler {
	return &Handler{
		pinger:  pinger,
		logger:  logger,
		timeout: timeout,
	}
}

// HandleLive returns process liveness. Always 200 with {"status":"healthy"}.
// No DB ping, no Pinger call — this path is hit by Cloud Run's probe and the
// GCP uptime check, which would otherwise keep Neon's compute warm 24/7.
func (h *Handler) HandleLive(w http.ResponseWriter, r *http.Request) {
	server.RespondJSON(w, r, http.StatusOK, Response{Status: StatusHealthy}, h.logger)
}

// HandleReady returns readiness, including database connectivity.
// Returns 200 OK when healthy, 503 Service Unavailable when database is down.
// Hit hourly by Cloud Scheduler.
func (h *Handler) HandleReady(w http.ResponseWriter, r *http.Request) {
	response := Response{
		Status: StatusHealthy,
	}
	statusCode := http.StatusOK

	// Check database connectivity if a pinger is configured
	if h.pinger != nil {
		ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
		defer cancel()

		if err := h.pinger.Ping(ctx); err != nil {
			h.logger.Warn("Database health check failed", "error", err)
			response.Status = StatusUnhealthy
			response.Database = StatusUnhealthy
			statusCode = http.StatusServiceUnavailable
		} else {
			response.Database = StatusHealthy
		}
	}

	server.RespondJSON(w, r, statusCode, response, h.logger)
}
