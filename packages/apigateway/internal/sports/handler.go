// Package sports provides the sport configuration endpoint handler.
package sports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// Handler holds dependencies for the sport config handler.
type Handler struct {
	logger         *slog.Logger
	configProvider func() []byte
}

// NewHandler creates a new sport config handler.
func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{
		logger:         logger,
		configProvider: config.GetRawConfigJSON,
	}
}

// HandleConfig serves the sport configuration JSON.
func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := h.configProvider()
	if len(data) == 0 {
		h.logger.Error("Embedded sport config is empty")
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Embedded sport config is not available",
		)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Validate it's valid JSON without unmarshaling
	if !json.Valid(data) {
		h.logger.Error("Embedded sport config is invalid JSON")
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			"JSON validation failed",
		)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Write raw JSON directly (no marshal/unmarshal cycle)
	server.RespondRawJSON(w, r, http.StatusOK, data, h.logger)
}
