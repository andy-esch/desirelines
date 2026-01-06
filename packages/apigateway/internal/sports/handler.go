// Package sports provides the sport configuration endpoint handler.
package sports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/apierrors"
)

// Handler holds dependencies for the sport config handler.
type Handler struct {
	logger *slog.Logger
}

// NewHandler creates a new sport config handler.
func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{
		logger: logger,
	}
}

// HandleConfig serves the sport configuration JSON.
func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := config.GetRawConfigJSON()
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

	// Write raw JSON directly (no marshal/unmarshal cycle)
	server.RespondRawJSON(w, r, http.StatusOK, data, h.logger)
}
