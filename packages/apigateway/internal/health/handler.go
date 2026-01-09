// Package health provides the health check endpoint handler.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
)

const (
	statusHealthy   = "healthy"
	statusUnhealthy = "unhealthy"
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
	pinger Pinger
	logger *slog.Logger
}

// NewHandler creates a new health check handler.
// The pinger parameter can be nil if no database is configured, or any type
// that implements Ping() (e.g., repository.ActivityRepository).
func NewHandler(pinger Pinger, logger *slog.Logger) *Handler {
	return &Handler{
		pinger: pinger,
		logger: logger,
	}
}

// Handle returns API health status.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	response := Response{
		Status: statusHealthy,
	}

	// Check database connectivity if a pinger is configured
	if h.pinger != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := h.pinger.Ping(ctx); err != nil {
			h.logger.Warn("Database health check failed", "error", err)
			response.Database = statusUnhealthy
		} else {
			response.Database = statusHealthy
		}
	}

	server.RespondJSON(w, r, http.StatusOK, response, h.logger)
}
