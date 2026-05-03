// Package httpadapter provides an HTTP adapter for the dispatcher.
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
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	sharedotel "github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
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

// Internal constants for recurring strings
const (
	hubModeSubscribe    = "subscribe"
	hubChallenge        = "hub.challenge"
	contentTypeJSON     = "application/json"
	webhookPublished    = "published"
	webhookAcknowledged = "acknowledged"
)

// maxChallengeLength is the maximum allowed length for hub.challenge.
// Strava sends short random strings; 256 bytes is generous.
const maxChallengeLength = 256

// Handler orchestrates the webhook processing.
type Handler struct {
	secretProvider     ports.SecretProvider
	publisher          ports.Publisher
	deauthPublisher    ports.Publisher
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
func NewHandler(publisher, deauthPublisher ports.Publisher, secretProvider ports.SecretProvider, stravaClient ports.StravaClient, tokenStore ports.TokenStore, logger *slog.Logger, cfg *HandlerConfig) *Handler {
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
		deauthPublisher:    deauthPublisher,
		stravaClient:       stravaClient,
		tokenStore:         tokenStore,
		logger:             logger,
		rateLimiter:        rateLimiter,
		maxRequestBodySize: maxBodySize,
		webhookCounter:     webhookCounter,
		httpHistogram:      httpHistogram,
	}
}

// RegisterRoutes configures the router with essential middleware and registers
// endpoints. The returned router assumes the caller wraps it in
// otelhttp.NewHandler so the OTel-dependent middleware (sharedotel.StampRequestID)
// has an active server span. See cmd/dispatcher/main.go.
func (h *Handler) RegisterRoutes() http.Handler {
	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(gcplog.BridgeRequestID)
	r.Use(gcplog.CloudRunRealIP)
	if h.rateLimiter != nil {
		r.Use(h.rateLimiter.Middleware)
	}
	r.Use(gcplog.WithCloudTraceContext)
	r.Use(sharedotel.StampRequestID)
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
	challenge := r.URL.Query().Get(hubChallenge)
	token := r.URL.Query().Get("hub.verify_token")

	if mode != hubModeSubscribe {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"invalid hub.mode",
			fmt.Sprintf("Invalid hub.mode provided in verification request: %s", mode),
		)
		apiErr.Code = ErrCodeInvalidHubMode
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	if challenge == "" || len(challenge) > maxChallengeLength {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid hub.challenge")
		apiErr.Code = ErrCodeInvalidChallenge
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
		apiErr.Code = ErrCodeConfigError
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	if subtle.ConstantTimeCompare([]byte(token), []byte(verifyToken)) != 1 {
		apiErr := apierrors.NewAPIError(http.StatusUnauthorized, "Invalid verify token")
		apiErr.Code = ErrCodeInvalidVerifyToken
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if encodeErr := json.NewEncoder(w).Encode(map[string]string{hubChallenge: challenge}); encodeErr != nil {
		h.logger.Error("Failed to encode response", "error", encodeErr)
	}
}

// handleEvent processes incoming Strava webhook POST events.
//
// Strava webhook spec (https://developers.strava.com/docs/webhooks/):
//   - object_type: "activity" or "athlete"
//   - aspect_type: "create", "update", or "delete"
//   - Activity updates contain: title, type, private
//   - Athlete deauth contains: updates={"authorized":"false"}
//   - Must respond 200 OK within 2 seconds; retried up to 3 total attempts on failure
//
// The orchestration is intentionally a flat sequence of "validate → enrich →
// route" stages, each in its own helper. Keeping handleEvent itself short
// keeps it under golangci-lint's gocyclo cap and makes the operational
// pipeline scannable at a glance.
func (h *Handler) handleEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	body, ok := h.readAndValidateBody(w, r)
	if !ok {
		return
	}

	webhook, ok := h.parseAndValidateWebhook(w, r, body)
	if !ok {
		return
	}

	if !h.checkSubscriptionID(w, r, webhook) {
		return
	}

	stampWebhookIDsOnSpan(ctx, webhook)

	correlationID := chiMiddleware.GetReqID(ctx)
	ctx = gcplog.WithCorrelationID(ctx, correlationID)

	h.recordWebhookMetric(ctx, webhook)

	h.routeWebhookEvent(ctx, w, r.WithContext(ctx), webhook, body, correlationID)
}

// readAndValidateBody enforces the Content-Type contract and reads the body
// behind a MaxBytesReader. Returns (body, true) on success; on failure writes
// the appropriate 4xx error and returns (nil, false).
func (h *Handler) readAndValidateBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != contentTypeJSON {
		apiErr := apierrors.NewAPIError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		apiErr.Code = ErrCodeInvalidContentType
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil, false
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxRequestBodySize)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Failed to read request body",
			fmt.Sprintf("Read failed: %v", err),
		)
		apiErr.Code = ErrCodeReadFailed
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil, false
	}
	return body, true
}

// parseAndValidateWebhook deserializes the JSON body into the proto type and
// runs proto-level validation. Returns (webhook, true) on success; on failure
// writes the appropriate 400 error and returns (nil, false).
func (h *Handler) parseAndValidateWebhook(w http.ResponseWriter, r *http.Request, body []byte) (*generated.WebhookEvent, bool) {
	webhook, err := webhookproto.ParseStravaWebhook(body)
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Invalid JSON payload",
			fmt.Sprintf("Proto parse failed: %v", err),
		)
		apiErr.Code = ErrCodeInvalidJSON
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil, false
	}
	if validateErr := webhookproto.Validate(webhook); validateErr != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusBadRequest,
			"Webhook validation failed",
			fmt.Sprintf("Validation error: %v", validateErr),
		)
		apiErr.Code = ErrCodeValidationFailed
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil, false
	}
	return webhook, true
}

// checkSubscriptionID looks up the configured Strava subscription ID and
// rejects any webhook that doesn't match. Returns true if the subscription
// matches; on mismatch or secret-fetch failure, writes the appropriate 4xx/5xx
// error and returns false.
func (h *Handler) checkSubscriptionID(w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent) bool {
	_, subscriptionID, err := h.secretProvider.GetSecrets()
	if err != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Configuration error",
			fmt.Sprintf("Failed to get subscription ID: %v", err),
		)
		apiErr.Code = ErrCodeConfigError
		apierrors.WriteError(w, r, apiErr, h.logger)
		return false
	}
	if webhook.SubscriptionId != subscriptionID {
		apiErr := apierrors.NewAPIError(http.StatusUnauthorized, "Invalid subscription_id")
		apiErr.Code = ErrCodeInvalidSubscriptionID
		apierrors.WriteError(w, r, apiErr, h.logger)
		return false
	}
	return true
}

// recordWebhookMetric increments the webhook-events counter labeled by
// aspect_type and object_type. No-op when no counter is configured.
func (h *Handler) recordWebhookMetric(ctx context.Context, webhook *generated.WebhookEvent) {
	if h.webhookCounter == nil {
		return
	}
	h.webhookCounter.Add(ctx, 1,
		metric.WithAttributes(
			attribute.String("aspect_type", webhookproto.AspectTypeToString(webhook.AspectType)),
			attribute.String("object_type", webhookproto.ObjectTypeToString(webhook.ObjectType)),
		),
	)
}

// routeWebhookEvent dispatches by object_type. Athlete events go to the deauth
// path; activity events flow through enrich + publish; everything else is
// acknowledged without further work.
func (h *Handler) routeWebhookEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent, body []byte, correlationID string) {
	switch webhook.ObjectType {
	case generated.ObjectType_OBJECT_TYPE_ATHLETE:
		h.handleAthleteEvent(ctx, w, r, webhook, body)
	case generated.ObjectType_OBJECT_TYPE_ACTIVITY:
		h.handleActivityEvent(ctx, w, r, webhook, correlationID)
	default:
		h.writeAcknowledged(w)
	}
}

// handleActivityEvent enriches CREATE events with the full Strava activity
// payload (best-effort if the activity was already deleted) and publishes the
// resulting EnrichedEvent. Other aspect types publish the bare webhook.
func (h *Handler) handleActivityEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent, correlationID string) {
	enriched := &generated.EnrichedEvent{Event: webhook}

	if webhook.AspectType == generated.AspectType_ASPECT_TYPE_CREATE {
		rawActivity, fetchErr := h.stravaClient.FetchActivity(ctx, webhook.OwnerId, webhook.ObjectId)
		switch {
		case fetchErr == nil:
			enriched.RawActivity = rawActivity
		case errors.Is(fetchErr, ports.ErrActivityNotFound):
			// Activity was deleted before we could fetch it — publish without
			// activity data so downstream knows the deletion happened.
			h.logger.Warn("Activity not found in Strava, publishing without activity data",
				"correlation_id", correlationID,
				"object_id", webhook.ObjectId)
		default:
			// Other Strava errors — return 500 so Strava retries (up to 3
			// total attempts per spec).
			apiErr := apierrors.NewAPIErrorWithLog(
				http.StatusInternalServerError,
				"Failed to fetch activity from Strava",
				fmt.Sprintf("Strava fetch failed: %v", fetchErr),
			)
			apiErr.Code = ErrCodeStravaFetchFailed
			apierrors.WriteError(w, r, apiErr, h.logger)
			return
		}
	}

	if publishErr := h.publisher.Publish(ctx, enriched, correlationID); publishErr != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to publish event",
			fmt.Sprintf("Publish failed: %v", publishErr),
		)
		apiErr.Code = ErrCodePublishFailed
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	h.writeSuccess(w)
}

// handleAthleteEvent processes athlete-type webhook events.
//
// Per Strava webhook docs (https://developers.strava.com/docs/webhooks/),
// deauthorization is signaled via object_type=athlete with
// updates={"authorized":"false"}. We also handle aspect_type=delete
// defensively in case Strava sends that form.
func (h *Handler) handleAthleteEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent, body []byte) {
	correlationID := gcplog.CorrelationIDFromContext(ctx)

	var isDeauth bool
	switch webhook.AspectType {
	case generated.AspectType_ASPECT_TYPE_DELETE:
		isDeauth = true
	case generated.AspectType_ASPECT_TYPE_UPDATE:
		// The proto parser only handles activity updates, so inspect the raw JSON
		// to detect the athlete deauthorization update payload.
		var payload struct {
			Updates map[string]string `json:"updates"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			h.logger.Warn("Failed to unmarshal athlete update payload",
				"correlation_id", correlationID,
				"error", err,
				"owner_id", webhook.OwnerId,
			)
		} else {
			if val, ok := payload.Updates["authorized"]; ok && val == "false" {
				isDeauth = true
			}
		}
	default:
		// Non-deauth athlete events (e.g., create) are acknowledged.
	}

	if !isDeauth {
		h.writeAcknowledged(w)
		return
	}

	h.logger.Info("Athlete deauthorization received",
		"owner_id", webhook.OwnerId,
		"correlation_id", correlationID,
		"aspect_type", webhook.AspectType.String(),
	)

	// Best-effort token deletion — the downstream deletion job will clean up on failure.
	if deleteErr := h.tokenStore.DeleteTokens(ctx, webhook.OwnerId); deleteErr != nil {
		h.logger.Warn("Failed to delete tokens during deauth (will be cleaned up by deletion job)",
			"correlation_id", correlationID,
			"owner_id", webhook.OwnerId,
			"error", deleteErr,
		)
	}

	// Publish the deauth event to the dedicated deauth topic so downstream consumers can act on it.
	enriched := &generated.EnrichedEvent{Event: webhook}
	if publishErr := h.deauthPublisher.Publish(ctx, enriched, correlationID); publishErr != nil {
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to publish deauth event",
			fmt.Sprintf("Publish failed: %v", publishErr),
		)
		apiErr.Code = ErrCodeDeauthFailed
		apierrors.WriteError(w, r, apiErr, h.logger)
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
//
// NOTE: Strava docs specify "200 OK" for acknowledgment. In practice Strava
// accepts any 2xx, but if retries are observed this should be changed to 200.
// We use 201 to distinguish "published to Pub/Sub" from "acknowledged but ignored".
func (h *Handler) writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(webhookResponse{Success: true, Action: webhookPublished}); err != nil {
		h.logger.Error("Failed to encode success response", "error", err)
	}
}

// writeAcknowledged returns 200 OK per Strava's webhook spec requirement.
// Used for events that are received but need no further processing
// (e.g., non-deauth athlete events) and for successfully handled deauth events.
func (h *Handler) writeAcknowledged(w http.ResponseWriter) {
	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(webhookResponse{Success: true, Action: webhookAcknowledged}); err != nil {
		h.logger.Error("Failed to encode acknowledged response", "error", err)
	}
}

// stampWebhookIDsOnSpan attaches the parsed identifiers to the active OTel
// server span. Pulled out of handleEvent so the latter stays under the
// cyclomatic-complexity limit.
//
// `OwnerId` is the Strava athlete ID across all object types and is always
// stamped. `ObjectId` ONLY represents an activity ID when the event is
// `OBJECT_TYPE_ACTIVITY`; for athlete (deauth) events `ObjectId` is the
// athlete ID, so stamping it as `desirelines.activity_id` would silently
// misclassify the trace and break the cross-service convention. Hence
// activity_id is gated on ObjectType.
//
// Attribute names match apigateway's HandleGetActivity span attribute (set
// via otel.AddChiURLParamsAs(r, {"id": "activity_id"})) so a single Cloud
// Trace filter `desirelines.activity_id=<id>` matches spans from BOTH
// services for the same activity. `enduser.id` is reserved for authenticated
// end-users; the dispatcher only handles Strava webhooks and does not
// authenticate end-users, so the athlete ID is namespaced under
// `desirelines.*` instead.
//
// No-op when no valid span is on the context.
func stampWebhookIDsOnSpan(ctx context.Context, webhook *generated.WebhookEvent) {
	span := trace.SpanFromContext(ctx)
	if !span.SpanContext().IsValid() {
		return
	}
	attrs := []attribute.KeyValue{
		attribute.Int64("desirelines.athlete_id", webhook.OwnerId),
	}
	if webhook.ObjectType == generated.ObjectType_OBJECT_TYPE_ACTIVITY {
		attrs = append(attrs, attribute.Int64("desirelines.activity_id", webhook.ObjectId))
	}
	span.SetAttributes(attrs...)
}
