// Package sports provides the sport configuration endpoint handler.
package sports

import (
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
)

// Handler holds dependencies for the sport config handler.
type Handler struct {
	logger      *slog.Logger
	sportConfig *config.SportConfig
}

// NewHandler creates a new sport config handler.
func NewHandler(logger *slog.Logger, sportConfig *config.SportConfig) *Handler {
	return &Handler{
		logger:      logger,
		sportConfig: sportConfig,
	}
}

// HandleConfig serves the compatible public sport configuration JSON.
func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	// The loader projects the internal registry to the public version-1.0 shape.
	data := h.sportConfig.APIJSON()
	if len(data) == 0 {
		h.logger.Error("Public sport config is empty")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Public sport config is not available",
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Cache static config for 1 hour
	w.Header().Set("Cache-Control", "public, max-age=3600")

	// Write raw JSON directly (no marshal/unmarshal cycle)
	server.RespondRawJSON(w, http.StatusOK, data, h.logger)
}
