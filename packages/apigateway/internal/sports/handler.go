// Package sports provides the sport configuration endpoint handler.
package sports

import (
	"encoding/json"
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

// HandleConfig serves the sport configuration JSON.
func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := h.sportConfig.RawJSON()
	if len(data) == 0 {
		h.logger.Error("Embedded sport config is empty")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Embedded sport config is not available",
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Validate it's valid JSON without unmarshaling
	if !json.Valid(data) {
		h.logger.Error("Embedded sport config is invalid JSON")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			"JSON validation failed",
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Cache static config for 1 hour
	w.Header().Set("Cache-Control", "public, max-age=3600")

	// Write raw JSON directly (no marshal/unmarshal cycle)
	server.RespondRawJSON(w, r, http.StatusOK, data, h.logger)
}
