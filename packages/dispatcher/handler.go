// Package dispatcher handles Strava webhook events and publishes them to PubSub.
// It provides HTTP handlers for receiving webhook notifications and processing them
// into structured events for downstream consumption.
package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

// Handler orchestrates the webhook processing.
type Handler struct {
	secretCache *SecretCache
	config      *Config
	publisher   Publisher
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

	// Create secret cache with default settings
	secretCache := NewDefaultSecretCache()

	return &Handler{
		secretCache: secretCache,
		config:      cfg,
		publisher:   publisher,
	}, nil
}

// NewHandlerWithPublisher is a constructor for testing that allows injecting a mock publisher.
func NewHandlerWithPublisher(cfg *Config, publisher Publisher) *Handler {
	// Create secret cache with default settings for testing
	secretCache := NewDefaultSecretCache()

	return &Handler{
		secretCache: secretCache,
		config:      cfg,
		publisher:   publisher,
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
		Logger.Info("Health check request", "correlation_id", correlationID)
		w.WriteHeader(http.StatusOK)
	default:
		Logger.Warn("Invalid request method", "correlation_id", correlationID, "method", r.Method)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "", correlationID)
	}
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request, correlationID string) {
	Logger.Info("Processing webhook verification request", "correlation_id", correlationID)

	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get("hub.challenge")
	token := r.URL.Query().Get("hub.verify_token")

	if mode != "subscribe" {
		msg := fmt.Sprintf("invalid hub.mode: %s", mode)
		Logger.Warn("Invalid hub.mode", "correlation_id", correlationID, "hub_mode", mode)
		writeError(w, http.StatusBadRequest, msg, "", correlationID)
		return
	}

	// Get current verify token from secret cache
	verifyToken, _, err := h.secretCache.GetSecrets()
	if err != nil {
		h.logAndWriteError(w, correlationID, http.StatusInternalServerError, "Configuration error", err, "Failed to get verify token")
		return
	}

	if token != verifyToken {
		h.logAndWriteError(w, correlationID, http.StatusUnauthorized, "Invalid verify token", nil, "Invalid verify token")
		return
	}

	Logger.Info("Webhook verification successful", "correlation_id", correlationID)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"hub.challenge": challenge}); err != nil {
		Logger.Error("Failed to encode response", "correlation_id", correlationID, "error", err)
	}
}

func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request, correlationID string) {
	Logger.Info("Processing webhook event", "correlation_id", correlationID)

	var webhook WebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		h.logAndWriteError(w, correlationID, http.StatusBadRequest, "Invalid JSON payload", err, "Invalid JSON payload")
		return
	}

	if err := webhook.Validate(); err != nil {
		h.logAndWriteError(w, correlationID, http.StatusBadRequest, "Webhook validation failed", err, "Webhook validation failed")
		return
	}

	// Get current subscription ID from secret cache
	_, subscriptionID, err := h.secretCache.GetSecrets()
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
		Logger.Info("Ignoring non-activity webhook", "correlation_id", correlationID, "object_type", webhook.ObjectType)
		writeSuccess(w, correlationID)
		return
	}

	if err := h.publisher.Publish(r.Context(), webhook, correlationID); err != nil {
		h.logAndWriteError(w, correlationID, http.StatusInternalServerError, "Failed to publish event", err, "Failed to publish webhook")
		return
	}

	Logger.Info("Webhook processing successful", "correlation_id", correlationID)
	writeSuccess(w, correlationID)
}

func writeError(w http.ResponseWriter, code int, msg, details, correlationID string) {
	w.WriteHeader(code)
	response := map[string]string{
		"error":          msg,
		"correlation_id": correlationID,
	}
	if details != "" {
		response["details"] = details
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		Logger.Error("Failed to encode error response", "correlation_id", correlationID, "error", err)
	}
}

func writeSuccess(w http.ResponseWriter, correlationID string) {
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"success":        "true",
		"correlation_id": correlationID,
	}); err != nil {
		Logger.Error("Failed to encode success response", "correlation_id", correlationID, "error", err)
	}
}

// logAndWriteError logs an error and writes an HTTP error response in one call.
func (h *Handler) logAndWriteError(w http.ResponseWriter, correlationID string,
	statusCode int, userMsg string, err error, logMsg string) {

	if err != nil {
		Logger.Error(logMsg, "correlation_id", correlationID, "error", err, "status_code", statusCode)
		writeError(w, statusCode, userMsg, err.Error(), correlationID)
	} else {
		Logger.Warn(logMsg, "correlation_id", correlationID, "status_code", statusCode)
		writeError(w, statusCode, userMsg, "", correlationID)
	}
}
