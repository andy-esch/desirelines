// Package dispatcher handles Strava webhook events and publishes them to PubSub.
// It provides HTTP handlers for receiving webhook notifications and processing them
// into structured events for downstream consumption.
package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

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

	// Create secret cache with 5-minute TTL
	secretCache := NewSecretCache("/etc/secrets/strava_auth.json", 5*time.Minute)

	return &Handler{
		secretCache: secretCache,
		config:      cfg,
		publisher:   publisher,
	}, nil
}

// NewHandlerWithPublisher is a constructor for testing that allows injecting a mock publisher.
func NewHandlerWithPublisher(cfg *Config, publisher Publisher) *Handler {
	// Create secret cache with 5-minute TTL for testing
	secretCache := NewSecretCache("/etc/secrets/strava_auth.json", 5*time.Minute)

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
		log.Printf("[%s] Health check request", correlationID)
		w.WriteHeader(http.StatusOK)
	default:
		log.Printf("[%s] Invalid request method: %s", correlationID, r.Method)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed", "", correlationID)
	}
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request, correlationID string) {
	log.Printf("[%s] Processing webhook verification request", correlationID)

	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get("hub.challenge")
	token := r.URL.Query().Get("hub.verify_token")

	if mode != "subscribe" {
		msg := fmt.Sprintf("invalid hub.mode: %s", mode)
		log.Printf("[%s] %s", correlationID, msg)
		writeError(w, http.StatusBadRequest, msg, "", correlationID)
		return
	}

	// Get current verify token from secret cache
	verifyToken, _, err := h.secretCache.GetSecrets()
	if err != nil {
		log.Printf("[%s] Failed to get verify token: %v", correlationID, err)
		writeError(w, http.StatusInternalServerError, "Configuration error", err.Error(), correlationID)
		return
	}

	if token != verifyToken {
		log.Printf("[%s] Invalid verify token", correlationID)
		writeError(w, http.StatusUnauthorized, "Invalid verify token", "", correlationID)
		return
	}

	log.Printf("[%s] Webhook verification successful", correlationID)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"hub.challenge": challenge})
}

func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request, correlationID string) {
	log.Printf("[%s] Processing webhook event", correlationID)

	var webhook WebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&webhook); err != nil {
		log.Printf("[%s] Invalid JSON payload: %v", correlationID, err)
		writeError(w, http.StatusBadRequest, "Invalid JSON payload", err.Error(), correlationID)
		return
	}

	if err := webhook.Validate(); err != nil {
		log.Printf("[%s] Webhook validation failed: %v", correlationID, err)
		writeError(w, http.StatusBadRequest, "Webhook validation failed", err.Error(), correlationID)
		return
	}

	// Get current subscription ID from secret cache
	_, subscriptionID, err := h.secretCache.GetSecrets()
	if err != nil {
		log.Printf("[%s] Failed to get subscription ID: %v", correlationID, err)
		writeError(w, http.StatusInternalServerError, "Configuration error", err.Error(), correlationID)
		return
	}

	if webhook.SubscriptionID != subscriptionID {
		msg := fmt.Sprintf("invalid subscription_id: %d", webhook.SubscriptionID)
		log.Printf("[%s] %s", correlationID, msg)
		writeError(w, http.StatusUnauthorized, msg, "", correlationID)
		return
	}

	if webhook.ObjectType != "activity" {
		log.Printf("[%s] Ignoring non-activity webhook: %s", correlationID, webhook.ObjectType)
		writeSuccess(w, correlationID)
		return
	}

	if err := h.publisher.Publish(r.Context(), webhook, correlationID); err != nil {
		log.Printf("[%s] Failed to publish webhook: %v", correlationID, err)
		writeError(w, http.StatusInternalServerError, "Failed to publish event", err.Error(), correlationID)
		return
	}

	log.Printf("[%s] Webhook processing successful", correlationID)
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
	json.NewEncoder(w).Encode(response)
}

func writeSuccess(w http.ResponseWriter, correlationID string) {
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"success":        "true",
		"correlation_id": correlationID,
	})
}
