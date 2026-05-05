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
	"fmt"
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

	// DefaultHealthCheckTimeout is the default per-attempt timeout for database
	// health checks. Sized for Neon cold-starts: the hourly Cloud Scheduler
	// /api/ready probe almost always lands on a suspended compute (5-min idle
	// window), and the wake routinely takes several seconds. A tighter budget
	// here flags every cold wake as "unhealthy" even when the DB is fine.
	DefaultHealthCheckTimeout = 10 * time.Second

	// DefaultHealthCheckRetryBackoff is the pause between the initial ping and
	// the single retry. Per Neon's official cold-start guidance: pair a longer
	// per-attempt timeout with a retry-after-backoff to absorb tail wake-time
	// without inflating the timeout to absurd values. One retry is enough —
	// genuine outages will keep failing on attempt #2.
	DefaultHealthCheckRetryBackoff = time.Second
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
	pinger       Pinger
	logger       *slog.Logger
	timeout      time.Duration
	retryBackoff time.Duration
}

// NewHandler creates a new health check handler with default timeout.
// The pinger parameter can be nil if no database is configured, or any type
// that implements Ping() (e.g., repository.ActivityRepository).
func NewHandler(pinger Pinger, logger *slog.Logger) *Handler {
	return NewHandlerWithTimeout(pinger, logger, DefaultHealthCheckTimeout)
}

// NewHandlerWithTimeout creates a new health check handler with custom
// per-attempt timeout. Retry backoff uses DefaultHealthCheckRetryBackoff.
func NewHandlerWithTimeout(pinger Pinger, logger *slog.Logger, timeout time.Duration) *Handler {
	return NewHandlerWithOptions(pinger, logger, timeout, DefaultHealthCheckRetryBackoff)
}

// NewHandlerWithOptions creates a health check handler with full control over
// per-attempt timeout and retry backoff.
func NewHandlerWithOptions(pinger Pinger, logger *slog.Logger, timeout, retryBackoff time.Duration) *Handler {
	return &Handler{
		pinger:       pinger,
		logger:       logger,
		timeout:      timeout,
		retryBackoff: retryBackoff,
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

	if h.pinger != nil {
		if err := h.pingWithRetry(r.Context()); err != nil {
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

// pingWithRetry runs the DB ping with one retry after a brief backoff. Each
// attempt gets the full per-attempt timeout. Total wall time is bounded by
// 2*timeout + retryBackoff. Returns nil on success (either attempt) or the
// retry's error. Returns the parent context's error if it's canceled during
// the backoff.
func (h *Handler) pingWithRetry(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, h.timeout)
	firstErr := h.pinger.Ping(ctx)
	cancel()
	if firstErr == nil {
		return nil
	}

	// Log the first failure even if the retry recovers — transient cold-start
	// spikes should stay visible for diagnostics (matches the Python helper).
	h.logger.Warn("Database health check failed, retrying",
		"error", firstErr, "backoff", h.retryBackoff)

	select {
	case <-time.After(h.retryBackoff):
	case <-parent.Done():
		return fmt.Errorf("readiness backoff interrupted: %w", parent.Err())
	}

	ctx2, cancel2 := context.WithTimeout(parent, h.timeout)
	defer cancel2()
	if retryErr := h.pinger.Ping(ctx2); retryErr != nil {
		return fmt.Errorf("database ping after retry: %w", retryErr)
	}
	h.logger.Info("Database ping succeeded after retry")
	return nil
}
