// Package httpadapter provides HTTP handlers for receiving webhook notifications.
package httpadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/middleware"
	"github.com/andy-esch/desirelines/packages/dispatcher/pkg/apierrors"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// Handler orchestrates the webhook processing.
type Handler struct {
	secretProvider ports.SecretProvider
	publisher      ports.Publisher
	logger         *slog.Logger
}

// NewHandler creates a new webhook handler with injected dependencies.
func NewHandler(publisher ports.Publisher, secretProvider ports.SecretProvider, logger *slog.Logger) *Handler {
	return &Handler{
		secretProvider: secretProvider,
		publisher:      publisher,
		logger:         logger,
	}
}

// RegisterRoutes configures the router with essential middleware and registers endpoints.
func (h *Handler) RegisterRoutes() http.Handler {
	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(middleware.Logger(h.logger))
	r.Use(chiMiddleware.Recoverer)

	r.Get("/", h.handleVerification)
	r.Post("/", h.handleEvent)
	r.Head("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	return r
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get("hub.challenge")
	token := r.URL.Query().Get("hub.verify_token")

	if mode != "subscribe" {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			fmt.Sprintf("invalid hub.mode: %s", mode),
			"Invalid hub.mode provided in verification request",
		)
		apiErr.Code = "INVALID_HUB_MODE"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Get current verify token from secret provider
	verifyToken, _, err := h.secretProvider.GetSecrets()
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Configuration error",
			fmt.Sprintf("Failed to get verify token: %v", err),
		)
		apiErr.Code = "CONFIG_ERROR"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	if token != verifyToken {
		apiErr := apierrors.NewAPIError(http.StatusUnauthorized, "Invalid verify token")
		apiErr.Code = "INVALID_VERIFY_TOKEN"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	w.WriteHeader(http.StatusOK)
	if encodeErr := json.NewEncoder(w).Encode(map[string]string{"hub.challenge": challenge}); encodeErr != nil {
		h.logger.Error("Failed to encode response", "error", encodeErr)
	}
}

const maxRequestBodySize = 1 << 20 // 1MB

func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request) {
	// Validate Content-Type header
	contentType := r.Header.Get("Content-Type")
	if contentType == "" || !strings.Contains(contentType, "application/json") {
		apiErr := apierrors.NewAPIError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		apiErr.Code = "INVALID_CONTENT_TYPE"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Check that request is under maxRequestBodySize
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Failed to read request body",
			fmt.Sprintf("Read failed: %v", err),
		)
		apiErr.Code = "READ_FAILED"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Parse JSON into Protobuf using adapter
	webhook, err := webhookproto.ParseStravaWebhook(bodyBytes)
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Invalid JSON payload",
			fmt.Sprintf("Proto parse failed: %v", err),
		)
		apiErr.Code = "INVALID_JSON"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Validate proto event
	if validateErr := webhookproto.Validate(webhook); validateErr != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Webhook validation failed",
			fmt.Sprintf("Validation error: %v", validateErr),
		)
		apiErr.Code = "VALIDATION_FAILED"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Get current subscription ID from secret provider
	_, subscriptionID, err := h.secretProvider.GetSecrets()
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Configuration error",
			fmt.Sprintf("Failed to get subscription ID: %v", err),
		)
		apiErr.Code = "CONFIG_ERROR"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Note: proto SubscriptionId is int32, config uses int. Cast safely.
	if int(webhook.SubscriptionId) != subscriptionID {
		apiErr := apierrors.NewAPIError(http.StatusUnauthorized, "Invalid subscription_id")
		apiErr.Code = "INVALID_SUBSCRIPTION_ID"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	if webhook.ObjectType != generated.ObjectType_OBJECT_TYPE_ACTIVITY {
		h.writeSuccess(w)
		return
	}

	if publishErr := h.publisher.Publish(r.Context(), webhook, chiMiddleware.GetReqID(r.Context())); publishErr != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to publish event",
			fmt.Sprintf("Publish failed: %v", publishErr),
		)
		apiErr.Code = "PUBLISH_FAILED"
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	h.writeSuccess(w)
}

func (h *Handler) writeSuccess(w http.ResponseWriter) {
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"success": "true",
	}); err != nil {
		h.logger.Error("Failed to encode success response", "error", err)
	}
}

// Close releases resources held by the handler (PubSub client, etc.).
func (h *Handler) Close(ctx context.Context) error {
	// Context is accepted for future use (e.g. graceful shutdown with timeout)
	_ = ctx
	return h.publisher.Close()
}
