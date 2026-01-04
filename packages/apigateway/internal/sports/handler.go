// Package sports provides the sport configuration endpoint handler.
package sports

import (
	"encoding/json"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

// Handler holds dependencies for the sport config handler.
type Handler struct {
	corsHandler apierrors.CORSHandler
}

// NewHandler creates a new sport config handler.
func NewHandler(corsHandler apierrors.CORSHandler) *Handler {
	return &Handler{
		corsHandler: corsHandler,
	}
}

// HandleConfig serves the sport configuration JSON.
func (h *Handler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := config.GetRawConfigJSON()
	if len(data) == 0 {
		logger.Logger.Error("Embedded sport config is empty")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Embedded sport config is not available",
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Validate it's valid JSON without unmarshaling
	if !json.Valid(data) {
		logger.Logger.Error("Embedded sport config is invalid JSON")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			"JSON validation failed",
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Write raw JSON directly (no marshal/unmarshal cycle)
	server.RespondRawJSON(w, r, http.StatusOK, data, h.corsHandler)
}
