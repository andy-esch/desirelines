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
	"os"
	"strconv"

	"github.com/google/uuid"
)

// Config holds all configuration for the dispatcher.
type Config struct {
	StravaWebhookVerifyToken    string
	StravaWebhookSubscriptionID int
	GCPProjectID                string
	GCPPubSubTopicID            string
	LogLevel                    string
}

// LoadConfig loads configuration from environment variables and mounted secrets.
func LoadConfig() (*Config, error) {
	// Load webhook secrets from mounted volume if available
	secretsPath := "/etc/secrets/strava_auth.json"
	if _, err := os.Stat(secretsPath); err == nil {
		secretsFile, err := os.Open(secretsPath)
		if err != nil {
			log.Printf("Failed to open secrets file: %v", err)
		} else {
			defer secretsFile.Close()

			var stravaAuth map[string]interface{}
			if err := json.NewDecoder(secretsFile).Decode(&stravaAuth); err != nil {
				log.Printf("Failed to decode secrets file: %v", err)
			} else {
				// Set environment variables from secrets (takes precedence)
				if verifyToken, ok := stravaAuth["verify_token"]; ok {
					log.Printf("Loading verify_token from secrets: %v", verifyToken)
					os.Setenv("STRAVA_WEBHOOK_VERIFY_TOKEN", fmt.Sprintf("%v", verifyToken))
				}
				if subscriptionID, ok := stravaAuth["subscription_id"]; ok {
					log.Printf("Loading subscription_id from secrets: %v", subscriptionID)
					os.Setenv("STRAVA_WEBHOOK_SUBSCRIPTION_ID", fmt.Sprintf("%v", subscriptionID))
				}
			}
		}
	}

	subIDStr := getEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
	log.Printf("Final subscription_id string from env: '%s'", subIDStr)
	subscriptionID, err := strconv.Atoi(subIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %v", err)
	}
	log.Printf("Parsed subscription_id as int: %d", subscriptionID)

	return &Config{
		StravaWebhookVerifyToken:    getEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", ""),
		StravaWebhookSubscriptionID: subscriptionID,
		GCPProjectID:                getEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID:            getEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:                    getEnvOrDefault("LOG_LEVEL", "INFO"),
	}, nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// Handler orchestrates the webhook processing.
type Handler struct {
	config    *Config
	publisher Publisher
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

	return &Handler{
		config:    cfg,
		publisher: publisher,
	}, nil
}

// NewHandlerWithPublisher is a constructor for testing that allows injecting a mock publisher.
func NewHandlerWithPublisher(cfg *Config, publisher Publisher) *Handler {
	return &Handler{
		config:    cfg,
		publisher: publisher,
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
	if token != h.config.StravaWebhookVerifyToken {
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

	if webhook.SubscriptionID != h.config.StravaWebhookSubscriptionID {
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
