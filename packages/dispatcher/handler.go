// Package dispatcher handles Strava webhook events and publishes them to PubSub.
// It provides HTTP handlers for receiving webhook notifications and processing them
// into structured events for downstream consumption.
package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// Handler orchestrates the webhook processing.
type Handler struct {
	secretProvider SecretProvider
	config         *Config
	publisher      Publisher
	logger         Logger
}

// NewHandler creates a new webhook handler.
func NewHandler(ctx context.Context) (*Handler, error) {
	cfg, err := LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	publisher, err := NewPubSubPublisher(ctx, cfg.GCPProjectID, cfg.GCPPubSubTopicID)
	if err != nil {
		return nil, fmt.Errorf("failed to create publisher: %w", err)
	}

	// Create secret provider with default settings
	secretProvider := NewDefaultSecretCache()

	return &Handler{
		secretProvider: secretProvider,
		config:         cfg,
		publisher:      publisher,
		logger:         DefaultLogger, // Use default logger for production
	}, nil
}

// NewHandlerWithDeps is a constructor that allows injecting all dependencies.
// This is the recommended constructor for testing and dependency injection.
func NewHandlerWithDeps(cfg *Config, publisher Publisher, secretProvider SecretProvider, logger Logger) *Handler {
	// Use default logger if none provided
	if logger == nil {
		logger = DefaultLogger
	}

	return &Handler{
		secretProvider: secretProvider,
		config:         cfg,
		publisher:      publisher,
		logger:         logger,
	}
}

// NewHandlerWithPublisher is a constructor for testing that allows injecting a mock publisher and logger.
// Deprecated: Use NewHandlerWithDeps instead for full dependency injection.
func NewHandlerWithPublisher(cfg *Config, publisher Publisher, logger Logger) *Handler {
	// Create secret cache with default settings for testing
	secretProvider := NewDefaultSecretCache()

	// Use default logger if none provided
	if logger == nil {
		logger = DefaultLogger
	}

	return &Handler{
		secretProvider: secretProvider,
		config:         cfg,
		publisher:      publisher,
		logger:         logger,
	}
}

// ServeHTTP is the main entry point for handling HTTP requests.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	correlationID := uuid.New().String()
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		h.handleVerification(w, r, correlationID)
	case http.MethodPost:
		h.handleEvent(w, r, correlationID)
	case http.MethodHead:
		h.logger.Info("Health check request", "correlation_id", correlationID)
		w.WriteHeader(http.StatusOK)
	default:
		h.logger.Warn("Invalid request method", "correlation_id", correlationID, "method", r.Method)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "", correlationID, h.logger)
	}
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request, correlationID string) {
	h.logger.Info("Processing webhook verification request", "correlation_id", correlationID)

	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get("hub.challenge")
	token := r.URL.Query().Get("hub.verify_token")

	if mode != "subscribe" {
		msg := fmt.Sprintf("invalid hub.mode: %s", mode)
		h.logger.Warn("Invalid hub.mode", "correlation_id", correlationID, "hub_mode", mode)
		writeError(w, http.StatusBadRequest, msg, "", correlationID, h.logger)
		return
	}

	// Get current verify token from secret provider
	verifyToken, _, err := h.secretProvider.GetSecrets()
	if err != nil {
		h.logAndWriteError(w, correlationID, http.StatusInternalServerError, "Configuration error", err, "Failed to get verify token")
		return
	}

	if token != verifyToken {
		h.logAndWriteError(w, correlationID, http.StatusUnauthorized, "Invalid verify token", nil, "Invalid verify token")
		return
	}

	h.logger.Info("Webhook verification successful", "correlation_id", correlationID)
	w.WriteHeader(http.StatusOK)
	if encodeErr := json.NewEncoder(w).Encode(map[string]string{"hub.challenge": challenge}); encodeErr != nil {
		h.logger.Error("Failed to encode response", "correlation_id", correlationID, "error", encodeErr)
	}
}

const maxRequestBodySize = 1 << 20 // 1MB

func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request, correlationID string) {
	h.logger.Info("Processing webhook event", "correlation_id", correlationID)

	// Validate Content-Type header
	contentType := r.Header.Get("Content-Type")
	if contentType == "" || !strings.Contains(contentType, "application/json") {
		h.logAndWriteError(w, correlationID, http.StatusUnsupportedMediaType,
			"Content-Type must be application/json", nil, "Invalid Content-Type")
		return
	}

	// Check that request is under maxRequestBodySize
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
	var webhook WebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		h.logAndWriteError(w, correlationID, http.StatusBadRequest, "Invalid JSON payload", err, "Invalid JSON payload")
		return
	}

	if err := webhook.Validate(); err != nil {
		h.logAndWriteError(w, correlationID, http.StatusBadRequest, "Webhook validation failed", err, "Webhook validation failed")
		return
	}

	// Get current subscription ID from secret provider
	_, subscriptionID, err := h.secretProvider.GetSecrets()
	if err != nil {
		h.logAndWriteError(w, correlationID, http.StatusInternalServerError, "Configuration error", err, "Failed to get subscription ID")
		return
	}

	if webhook.SubscriptionID != subscriptionID {
		msg := fmt.Sprintf("invalid subscription_id: %d", webhook.SubscriptionID)
		h.logAndWriteError(w, correlationID, http.StatusUnauthorized, msg, nil, msg)
		return
	}

	if webhook.ObjectType != ObjectActivity {
		h.logger.Info("Ignoring non-activity webhook", "correlation_id", correlationID, "object_type", webhook.ObjectType)
		writeSuccess(w, correlationID, h.logger)
		return
	}

	if publishErr := h.publisher.Publish(r.Context(), webhook, correlationID); publishErr != nil {
		h.logAndWriteError(w, correlationID, http.StatusInternalServerError, "Failed to publish event", publishErr, "Failed to publish webhook")
		return
	}

	h.logger.Info("Webhook processing successful", "correlation_id", correlationID)
	writeSuccess(w, correlationID, h.logger)
}

func writeError(w http.ResponseWriter, code int, msg, details, correlationID string, logger Logger) {
	w.WriteHeader(code)
	response := map[string]string{
		"error":          msg,
		"correlation_id": correlationID,
	}
	if details != "" {
		response["details"] = details
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode error response", "correlation_id", correlationID, "error", err)
	}
}

func writeSuccess(w http.ResponseWriter, correlationID string, logger Logger) {
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"success":        "true",
		"correlation_id": correlationID,
	}); err != nil {
		logger.Error("Failed to encode success response", "correlation_id", correlationID, "error", err)
	}
}

// Close releases resources held by the handler (PubSub client, etc.).
// This is optional in Cloud Functions where the platform handles cleanup,
// but useful for graceful shutdown in long-running services.
//
// The context parameter allows for cancellation during cleanup.
// Pass context.Background() if no timeout is needed.
func (h *Handler) Close(ctx context.Context) error {
	// Currently PubSub client Close() doesn't use context,
	// but we accept it for future extensibility and consistency with Go idioms.
	_ = ctx
	return h.publisher.Close()
}

// logAndWriteError logs an error and writes an HTTP error response in one call.
func (h *Handler) logAndWriteError(w http.ResponseWriter, correlationID string,
	statusCode int, userMsg string, err error, logMsg string,
) {
	if err != nil {
		h.logger.Error(logMsg, "correlation_id", correlationID, "error", err, "status_code", statusCode)
		writeError(w, statusCode, userMsg, err.Error(), correlationID, h.logger)
	} else {
		h.logger.Warn(logMsg, "correlation_id", correlationID, "status_code", statusCode)
		writeError(w, statusCode, userMsg, "", correlationID, h.logger)
	}
}
