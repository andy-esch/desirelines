// Package health provides the health check endpoint handler.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

const (
	statusHealthy   = "healthy"
	statusUnhealthy = "unhealthy"
)

// Response is the JSON structure returned by the health endpoint.
type Response struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

// Handler holds dependencies for the health check handler.
type Handler struct {
	repo   repository.ActivityRepository
	logger *slog.Logger
}

// NewHandler creates a new health check handler.
func NewHandler(repo repository.ActivityRepository, logger *slog.Logger) *Handler {
	return &Handler{
		repo:   repo,
		logger: logger,
	}
}

// Handle returns API health status.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	response := Response{
		Status: statusHealthy,
	}

	// Check database connectivity if repository is available
	if h.repo != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := h.repo.Ping(ctx); err != nil {
			h.logger.Warn("Database health check failed", "error", err)
			response.Database = statusUnhealthy
		} else {
			response.Database = statusHealthy
		}
	}

	server.RespondJSON(w, r, http.StatusOK, response, h.logger)
}
