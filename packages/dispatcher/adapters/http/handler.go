package httpadapter

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Error codes
const (
	ErrCodeConfigError           = "CONFIG_ERROR"
	ErrCodeInvalidHubMode        = "INVALID_HUB_MODE"
	ErrCodeInvalidVerifyToken    = "INVALID_VERIFY_TOKEN"
	ErrCodeInvalidContentType    = "INVALID_CONTENT_TYPE"
	ErrCodeReadFailed            = "READ_FAILED"
	ErrCodeInvalidJSON           = "INVALID_JSON"
	ErrCodeValidationFailed      = "VALIDATION_FAILED"
	ErrCodeInvalidSubscriptionID = "INVALID_SUBSCRIPTION_ID"
	ErrCodePublishFailed         = "PUBLISH_FAILED"
	ErrCodeStravaFetchFailed     = "STRAVA_FETCH_FAILED"
	ErrCodeInvalidChallenge      = "INVALID_CHALLENGE"
	ErrCodeDeauthFailed          = "DEAUTH_FAILED"
)

// maxChallengeLength is the maximum allowed length for hub.challenge.
// Strava sends short random strings; 256 bytes is generous.
const maxChallengeLength = 256

// Handler orchestrates the webhook processing.
type Handler struct {
	secretProvider     ports.SecretProvider
	publisher          ports.Publisher
	stravaClient       ports.StravaClient
	tokenStore         ports.TokenStore
	logger             *slog.Logger
	rateLimiter        *ratelimit.Limiter
	maxRequestBodySize int64
	webhookCounter     metric.Int64Counter
	httpHistogram      metric.Float64Histogram
}

// HandlerConfig holds configuration for the HTTP handler.
type HandlerConfig struct {
	MaxRequestBodySize int64
	RateLimiter        *ratelimit.Limiter
	WebhookCounter     metric.Int64Counter
	HTTPHistogram      metric.Float64Histogram
}

// NewHandler creates a new webhook handler with injected dependencies.
func NewHandler(publisher ports.Publisher, secretProvider ports.SecretProvider, stravaClient ports.StravaClient, tokenStore ports.TokenStore, logger *slog.Logger, cfg *HandlerConfig) *Handler {
	maxBodySize := config.DefaultMaxRequestBodySize
	if cfg != nil && cfg.MaxRequestBodySize > 0 {
		maxBodySize = cfg.MaxRequestBodySize
	}
	var rateLimiter *ratelimit.Limiter
	var webhookCounter metric.Int64Counter
	var httpHistogram metric.Float64Histogram
	if cfg != nil {
		rateLimiter = cfg.RateLimiter
		webhookCounter = cfg.WebhookCounter
		httpHistogram = cfg.HTTPHistogram
	}
	return &Handler{
		secretProvider:     secretProvider,
		publisher:          publisher,
		stravaClient:       stravaClient,
		tokenStore:         tokenStore,
		logger:             logger,
		rateLimiter:        rateLimiter,
		maxRequestBodySize: maxBodySize,
		webhookCounter:     webhookCounter,
		httpHistogram:      httpHistogram,
	}
}

// RegisterRoutes configures the router with essential middleware and registers endpoints.
func (h *Handler) RegisterRoutes() http.Handler {
	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(gcplog.CloudRunRealIP)
	if h.rateLimiter != nil {
		r.Use(h.rateLimiter.Middleware)
	}
	r.Use(gcplog.WithCloudTraceContext)
	r.Use(gcplog.HTTPRequestLoggerWithMetrics(h.logger, h.httpHistogram))
	r.Use(chiMiddleware.Recoverer)

	// Health check endpoint for Cloud Run / docker health checks
	r.Head("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
	})

	// Strava webhook endpoints
	r.Get("/webhook", h.handleVerification)
	r.Post("/webhook", h.handleEvent)

	return r
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get("hub.challenge")
	token := r.URL.Query().Get("hub.verify_token")

	if mode != "subscribe" {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"invalid hub.mode",
			fmt.Sprintf("Invalid hub.mode provided in verification request: %s", mode),
		)
		apiErr.Code = ErrCodeInvalidHubMode
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	if challenge == "" || len(challenge) > maxChallengeLength {
		apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid hub.challenge")
		apiErr.Code = ErrCodeInvalidChallenge
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Get current verify token from secret provider
	verifyToken, _, err := h.secretProvider.GetSecrets()
	if err != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Configuration error",
			fmt.Sprintf("Failed to get verify token: %v", err),
		)
		apiErr.Code = ErrCodeConfigError
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	if subtle.ConstantTimeCompare([]byte(token), []byte(verifyToken)) != 1 {
		apiErr := gcplog.NewAPIError(http.StatusUnauthorized, "Invalid verify token")
		apiErr.Code = ErrCodeInvalidVerifyToken
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	w.WriteHeader(http.StatusOK)
	if encodeErr := json.NewEncoder(w).Encode(map[string]string{"hub.challenge": challenge}); encodeErr != nil {
		h.logger.Error("Failed to encode response", "error", encodeErr)
	}
}

func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request) {
	// Validate Content-Type header
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		apiErr := gcplog.NewAPIError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		apiErr.Code = ErrCodeInvalidContentType
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Limit request body size to prevent memory exhaustion
	r.Body = http.MaxBytesReader(w, r.Body, h.maxRequestBodySize)

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Failed to read request body",
			fmt.Sprintf("Read failed: %v", err),
		)
		apiErr.Code = ErrCodeReadFailed
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Parse JSON into Protobuf using adapter
	webhook, err := webhookproto.ParseStravaWebhook(bodyBytes)
	if err != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Invalid JSON payload",
			fmt.Sprintf("Proto parse failed: %v", err),
		)
		apiErr.Code = ErrCodeInvalidJSON
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Validate proto event
	if validateErr := webhookproto.Validate(webhook); validateErr != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Webhook validation failed",
			fmt.Sprintf("Validation error: %v", validateErr),
		)
		apiErr.Code = ErrCodeValidationFailed
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Get current subscription ID from secret provider
	// subscriptionID is already int32, validated at load time
	_, subscriptionID, err := h.secretProvider.GetSecrets()
	if err != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Configuration error",
			fmt.Sprintf("Failed to get subscription ID: %v", err),
		)
		apiErr.Code = ErrCodeConfigError
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	if webhook.SubscriptionId != subscriptionID {
		apiErr := gcplog.NewAPIError(http.StatusUnauthorized, "Invalid subscription_id")
		apiErr.Code = ErrCodeInvalidSubscriptionID
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Record webhook event metric
	if h.webhookCounter != nil {
		h.webhookCounter.Add(r.Context(), 1,
			metric.WithAttributes(
				attribute.String("aspect_type", webhookproto.AspectTypeToString(webhook.AspectType)),
				attribute.String("object_type", webhookproto.ObjectTypeToString(webhook.ObjectType)),
			),
		)
	}

	// Handle athlete events (deauthorization) separately from activity events.
	if webhook.ObjectType == generated.ObjectType_OBJECT_TYPE_ATHLETE {
		h.handleAthleteEvent(r.Context(), w, r, webhook)
		return
	}

	if webhook.ObjectType != generated.ObjectType_OBJECT_TYPE_ACTIVITY {
		h.writeAcknowledged(w)
		return
	}

	// Build enriched event wrapping the webhook
	enriched := &generated.EnrichedEvent{Event: webhook}

	// For CREATE events, fetch the activity from Strava API
	if webhook.AspectType == generated.AspectType_ASPECT_TYPE_CREATE {
		rawActivity, fetchErr := h.stravaClient.FetchActivity(r.Context(), webhook.OwnerId, webhook.ObjectId)
		if fetchErr != nil {
			if errors.Is(fetchErr, ports.ErrActivityNotFound) {
				// Activity was deleted before we could fetch it - publish without activity data
				h.logger.Warn("Activity not found in Strava, publishing without activity data",
					"object_id", webhook.ObjectId)
			} else {
				// Other Strava errors - return 500 so Strava retries the webhook
				apiErr := gcplog.NewAPIErrorWithLog(
					http.StatusInternalServerError,
					"Failed to fetch activity from Strava",
					fmt.Sprintf("Strava fetch failed: %v", fetchErr),
				)
				apiErr.Code = ErrCodeStravaFetchFailed
				gcplog.WriteError(w, r, apiErr, h.logger)
				return
			}
		} else {
			enriched.RawActivity = rawActivity
		}
	}

	correlationID := chiMiddleware.GetReqID(r.Context())
	if publishErr := h.publisher.Publish(r.Context(), enriched, correlationID); publishErr != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to publish event",
			fmt.Sprintf("Publish failed: %v", publishErr),
		)
		apiErr.Code = ErrCodePublishFailed
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	h.writeSuccess(w)
}

// handleAthleteEvent processes athlete-type webhook events.
// For deauthorization (aspect_type=delete), it deletes stored tokens and publishes the event.
// Non-deauth athlete events are acknowledged without processing.
func (h *Handler) handleAthleteEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent) {
	if webhook.AspectType != generated.AspectType_ASPECT_TYPE_DELETE {
		h.writeAcknowledged(w)
		return
	}

	correlationID := chiMiddleware.GetReqID(ctx)
	h.logger.Info("Athlete deauthorization received",
		"owner_id", webhook.OwnerId,
		"correlation_id", correlationID,
	)

	// Best-effort token deletion — the downstream deletion job will clean up on failure.
	if deleteErr := h.tokenStore.DeleteTokens(ctx, webhook.OwnerId); deleteErr != nil {
		h.logger.Warn("Failed to delete tokens during deauth (will be cleaned up by deletion job)",
			"owner_id", webhook.OwnerId,
			"error", deleteErr,
		)
	}

	// Publish the deauth event so downstream consumers (e.g., deletion job) can act on it.
	enriched := &generated.EnrichedEvent{Event: webhook}
	if publishErr := h.publisher.Publish(ctx, enriched, correlationID); publishErr != nil {
		apiErr := gcplog.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to publish deauth event",
			fmt.Sprintf("Publish failed: %v", publishErr),
		)
		apiErr.Code = ErrCodeDeauthFailed
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	h.writeAcknowledged(w)
}

// webhookResponse is the JSON response for successful webhook processing.
type webhookResponse struct {
	Success bool   `json:"success"`
	Action  string `json:"action"`
}

// writeSuccess returns 201 Created when a message is published to Pub/Sub.
func (h *Handler) writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(webhookResponse{Success: true, Action: "published"}); err != nil {
		h.logger.Error("Failed to encode success response", "error", err)
	}
}

// writeAcknowledged returns 200 OK when a webhook is received but no action is taken
// (e.g., non-activity events that are intentionally ignored).
func (h *Handler) writeAcknowledged(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(webhookResponse{Success: true, Action: "acknowledged"}); err != nil {
		h.logger.Error("Failed to encode acknowledged response", "error", err)
	}
}
