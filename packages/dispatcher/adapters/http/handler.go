// Package httpadapter provides an HTTP adapter for the dispatcher.
package httpadapter

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/bqrow"
	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	pubsubadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/pubsub"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/allowlist"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	sharedotel "github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// tracerScope is the OTel instrumentation scope for handler-emitted spans.
// Matches the scope used by other dispatcher components so spans share the
// same instrumentation library identity in Cloud Trace.
const tracerScope = "desirelines.io"

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
	ErrCodeAllowlistCheckFailed  = "ALLOWLIST_CHECK_FAILED"
)

// Owner-allowlist check outcomes (label values for the owner_check counter).
const (
	ownerCheckAllowed = "allowed"
	ownerCheckStray   = "stray"
	ownerCheckOrphan  = "orphan"
	ownerCheckError   = "error"
)

// Outcomes of the best-effort activity-row publish (label values for the
// row_publish counter). Every activity event that reaches the publish step
// records exactly one of these.
const (
	rowPublishPublished = "published"
	rowPublishSkipped   = "skipped"
	rowPublishError     = "error"
)

// Reasons an activity event produces no row (the `detail` label on a
// rowPublishSkipped count). Only aspect types that carry no publishable row
// appear here; anything unexpected is an error, not a skip.
const (
	// rowSkipNoActivity: the activity no longer exists in Strava, so there is
	// no row to write — either a CREATE whose fetch found nothing, or a
	// metadata-only UPDATE whose re-fetch 404'd. The DELETE event that follows
	// is what matters.
	rowSkipNoActivity = "no_activity"
	// rowSkipNoTokens: the athlete has no stored Strava tokens, so the activity
	// cannot be re-fetched. A deauthorization that has not been cleaned up yet,
	// or a revoked grant. Retrying cannot help and nothing is broken on our
	// side, so this is a skip rather than an error — paging on it would wake
	// someone for a user-state condition.
	//
	// Only reachable for metadata-only updates: any event that fetches on the
	// primary path hits the orphan branch there and returns before this runs.
	rowSkipNoTokens = "no_tokens"
	// rowSkipUnsupportedAspect: an aspect type outside create/update/delete.
	rowSkipUnsupportedAspect = "unsupported_aspect"
)

// Where a rowPublishError happened (the `detail` label on an error count).
// These are the values an alert on the error rate resolves to a cause, so keep
// them distinct enough to act on without reading logs first.
const (
	// rowErrorRefetch: Strava would not re-serve an activity that still
	// exists — an outage, a rate limit, a token problem. Deliberately an error
	// and not a skip: sustained, it means rows have stopped updating, which is
	// precisely what the error-rate alert exists to catch.
	rowErrorRefetch = "refetch"
	// rowErrorBuild: the activity payload could not be mapped onto a row.
	rowErrorBuild = "build"
	// rowErrorPublish: the row was built but Pub/Sub rejected it.
	rowErrorPublish = "publish"
	// rowErrorPanic: a bug in the mapping. Should never appear.
	rowErrorPanic = "panic"
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

// handleEventDeadline bounds per-request work end-to-end so the worst-case
// product of Strava httpClientTimeout × retries and the PubSub publish
// timeout cannot compose past one budget. Strava's webhook spec wants 2s;
// 10s leaves headroom for one Strava call + one PubSub publish while
// staying well under Cloud Run's default 60s request timeout.
const handleEventDeadline = 10 * time.Second

// DefaultRowRefetchTimeout bounds the Strava re-fetch the activity-row publish
// makes for a metadata-only update. It is deliberately far tighter than
// handleEventDeadline: that budget exists for work the webhook depends on, and
// this call is best-effort for a table nothing reads. Left on the full budget, a
// slow Strava would spend seconds here after the webhook was already handled and
// push the response past the 2s Strava allows before redelivering.
//
// 1s against an observed ~288ms mean for an activity fetch — roughly 3× headroom
// for a normal call, while cutting off the pathological one. It also admits only
// a single attempt, since the client's retry backoff starts at 1s; retries belong
// on the primary path, not here.
const DefaultRowRefetchTimeout = 1 * time.Second

// Handler orchestrates the webhook processing.
type Handler struct {
	secretProvider     ports.SecretProvider
	publisher          ports.Publisher
	deauthPublisher    ports.Publisher
	rowPublisher       ports.RawPublisher
	stravaClient       ports.StravaClient
	tokenStore         ports.TokenStore
	allowlist          allowlist.Checker
	logger             *slog.Logger
	rateLimiter        *ratelimit.Limiter
	maxRequestBodySize int64
	webhookCounter     metric.Int64Counter
	ownerCheckCounter  metric.Int64Counter
	rowPublishCounter  metric.Int64Counter
	rowRefetchTimeout  time.Duration
	httpHistogram      metric.Float64Histogram
	tracer             trace.Tracer
}

// HandlerConfig holds configuration for the HTTP handler.
type HandlerConfig struct {
	MaxRequestBodySize int64
	RateLimiter        *ratelimit.Limiter
	WebhookCounter     metric.Int64Counter
	OwnerCheckCounter  metric.Int64Counter
	HTTPHistogram      metric.Float64Histogram
	// RowPublisher enables the best-effort second publish of each activity as
	// a BigQuery CDC row. Nil — the default — disables it entirely; that is
	// what the feature flag being off looks like from in here.
	RowPublisher ports.RawPublisher
	// RowPublishCounter counts the outcome of every row publish attempt
	// (published / skipped / error). Optional; nil disables the metric.
	RowPublishCounter metric.Int64Counter
	// RowRefetchTimeout bounds the Strava re-fetch made for a metadata-only
	// update. Zero takes DefaultRowRefetchTimeout.
	RowRefetchTimeout time.Duration
	// Tracer is used for handler-level spans (e.g. allowlist check). If nil
	// at construction time the handler falls back to a no-op tracer; spans
	// inside the handler simply don't get emitted.
	Tracer trace.Tracer
}

// NewHandler creates a new webhook handler with injected dependencies.
func NewHandler(publisher, deauthPublisher ports.Publisher, secretProvider ports.SecretProvider, stravaClient ports.StravaClient, tokenStore ports.TokenStore, allowChecker allowlist.Checker, logger *slog.Logger, cfg *HandlerConfig) *Handler {
	if cfg == nil {
		cfg = &HandlerConfig{}
	}
	maxBodySize := config.DefaultMaxRequestBodySize
	if cfg.MaxRequestBodySize > 0 {
		maxBodySize = cfg.MaxRequestBodySize
	}
	rowRefetchTimeout := DefaultRowRefetchTimeout
	if cfg.RowRefetchTimeout > 0 {
		rowRefetchTimeout = cfg.RowRefetchTimeout
	}
	tracer := cfg.Tracer
	if tracer == nil {
		// Fall back to the global tracer provider so the handler always has
		// a working tracer, including when callers construct it without a
		// HandlerConfig (e.g. some tests). This matches what otel.Setup()
		// registers globally; if OTel is disabled it's the no-op tracer.
		tracer = otel.Tracer(tracerScope)
	}
	return &Handler{
		secretProvider:     secretProvider,
		publisher:          publisher,
		deauthPublisher:    deauthPublisher,
		rowPublisher:       cfg.RowPublisher,
		stravaClient:       stravaClient,
		tokenStore:         tokenStore,
		allowlist:          allowChecker,
		logger:             logger,
		rateLimiter:        cfg.RateLimiter,
		maxRequestBodySize: maxBodySize,
		webhookCounter:     cfg.WebhookCounter,
		ownerCheckCounter:  cfg.OwnerCheckCounter,
		rowPublishCounter:  cfg.RowPublishCounter,
		rowRefetchTimeout:  rowRefetchTimeout,
		httpHistogram:      cfg.HTTPHistogram,
		tracer:             tracer,
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
		// 429 rejections short-circuit here, before HTTPRequestLoggerWithMetrics —
		// by design, so a fast reject doesn't pollute the latency histogram. The
		// limiter self-reports rejections via its desirelines.io/ratelimit/rejected
		// counter instead.
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

// writeError builds a coded APIError and writes it with the handler's logger.
// An empty logMessage falls back to message inside apierrors.WriteError.
func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, status int, code, message, logMessage string) {
	apierrors.WriteCoded(w, r, h.logger, status, code, message, logMessage)
}

func (h *Handler) handleVerification(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	challenge := r.URL.Query().Get(hubChallenge)
	token := r.URL.Query().Get("hub.verify_token")

	if mode != hubModeSubscribe {
		h.writeError(w, r, http.StatusBadRequest, ErrCodeInvalidHubMode,
			"invalid hub.mode",
			fmt.Sprintf("Invalid hub.mode provided in verification request: %s", mode))
		return
	}

	if challenge == "" || len(challenge) > maxChallengeLength {
		h.writeError(w, r, http.StatusBadRequest, ErrCodeInvalidChallenge, "Invalid hub.challenge", "")
		return
	}

	// Get current verify token from secret provider
	verifyToken, _, err := h.secretProvider.GetSecrets()
	if err != nil {
		h.writeError(w, r, http.StatusInternalServerError, ErrCodeConfigError,
			"Configuration error",
			fmt.Sprintf("Failed to get verify token: %v", err))
		return
	}

	// Defense-in-depth: subtle.ConstantTimeCompare returns 1 when both
	// slices are empty, so an empty configured verifyToken would let any
	// caller pass verification and echo hub.challenge. The secret loader
	// already rejects empty tokens; this guard makes the handler safe even
	// against a SecretProvider that returns ("", nil).
	if verifyToken == "" {
		h.writeError(w, r, http.StatusInternalServerError, ErrCodeConfigError,
			"Configuration error", "Verify token is not configured")
		return
	}

	// Hash both sides to fixed-size 32-byte digests before the
	// constant-time compare. subtle.ConstantTimeCompare returns early
	// when input lengths differ — comparing the digests means the
	// compare always runs over the same byte count regardless of the
	// inbound token's length, eliminating any length-based timing
	// channel on the configured verifyToken.
	tokenHash := sha256.Sum256([]byte(token))
	verifyTokenHash := sha256.Sum256([]byte(verifyToken))
	if token == "" || subtle.ConstantTimeCompare(tokenHash[:], verifyTokenHash[:]) != 1 {
		h.writeError(w, r, http.StatusUnauthorized, ErrCodeInvalidVerifyToken, "Invalid verify token", "")
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
	// Cap total per-request work under handleEventDeadline so downstream
	// timeouts (Strava client + retries, PubSub publish) compose under a
	// single budget instead of stacking independently.
	ctx, cancel := context.WithTimeout(r.Context(), handleEventDeadline)
	defer cancel()

	// Capture the receive timestamp before any work — this becomes the
	// anchor for SLO 3 (data freshness): the time from "Strava POSTed
	// the webhook" to "row visible in postgres." Stashing on the context
	// here lets the publisher stamp it as a Pub/Sub attribute later
	// without needing to thread the timestamp through every helper.
	ctx = pubsubadapter.WithWebhookReceivedAt(ctx, time.Now())
	r = r.WithContext(ctx)

	body, ok := h.readAndValidateBody(w, r)
	if !ok {
		return
	}

	webhook, ok := h.parseAndValidateWebhook(w, r, body)
	if !ok {
		return
	}

	// Stamp identity before any authorization check so subscription-
	// mismatch (401) traces remain correlatable by athlete_id.
	stampWebhookIDsOnSpan(ctx, webhook)

	if !h.checkSubscriptionID(w, r, webhook) {
		return
	}

	correlationID := chiMiddleware.GetReqID(ctx)
	ctx = gcplog.WithCorrelationID(ctx, correlationID)

	h.recordWebhookMetric(ctx, webhook)

	h.routeWebhookEvent(ctx, w, r.WithContext(ctx), webhook, body, correlationID)
}

// readAndValidateBody enforces the Content-Type contract and reads the body
// behind a MaxBytesReader. Returns (body, true) on success; on failure writes
// the appropriate 4xx error and returns (nil, false).
func (h *Handler) readAndValidateBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	ctx, spanDone := sharedotel.StartSpan(r.Context(), h.tracer, "dispatcher.webhook.validate_body")
	var spanErr error
	defer func() { spanDone(spanErr) }()

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != contentTypeJSON {
		spanErr = fmt.Errorf("unsupported content-type %q", r.Header.Get("Content-Type"))
		h.writeError(w, r, http.StatusUnsupportedMediaType, ErrCodeInvalidContentType,
			"Content-Type must be application/json", "")
		return nil, false
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxRequestBodySize)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		spanErr = err
		h.writeError(w, r, http.StatusBadRequest, ErrCodeReadFailed,
			"Failed to read request body",
			fmt.Sprintf("Read failed: %v", err))
		return nil, false
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.Int("desirelines.body_size_bytes", len(body)))
	return body, true
}

// parseAndValidateWebhook deserializes the JSON body into the proto type and
// runs proto-level validation. Returns (webhook, true) on success; on failure
// writes the appropriate 400 error and returns (nil, false).
func (h *Handler) parseAndValidateWebhook(w http.ResponseWriter, r *http.Request, body []byte) (*generated.WebhookEvent, bool) {
	ctx, spanDone := sharedotel.StartSpan(r.Context(), h.tracer, "dispatcher.webhook.parse")
	var spanErr error
	defer func() { spanDone(spanErr) }()

	webhook, err := webhookproto.ParseStravaWebhook(body)
	if err != nil {
		spanErr = err
		h.writeError(w, r, http.StatusBadRequest, ErrCodeInvalidJSON,
			"Invalid JSON payload",
			fmt.Sprintf("Proto parse failed: %v", err))
		return nil, false
	}
	if validateErr := webhookproto.Validate(webhook); validateErr != nil {
		spanErr = validateErr
		h.writeError(w, r, http.StatusBadRequest, ErrCodeValidationFailed,
			"Webhook validation failed",
			fmt.Sprintf("Validation error: %v", validateErr))
		return nil, false
	}
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.String("desirelines.aspect_type", webhook.AspectType.String()),
		attribute.String("desirelines.object_type", webhook.ObjectType.String()),
	)
	return webhook, true
}

// checkSubscriptionID looks up the configured Strava subscription ID and
// rejects any webhook that doesn't match. Returns true if the subscription
// matches; on mismatch or secret-fetch failure, writes the appropriate 4xx/5xx
// error and returns false.
func (h *Handler) checkSubscriptionID(w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent) bool {
	ctx, spanDone := sharedotel.StartSpan(r.Context(), h.tracer, "dispatcher.webhook.check_subscription_id")
	var spanErr error
	defer func() { spanDone(spanErr) }()

	_, subscriptionID, err := h.secretProvider.GetSecrets()
	if err != nil {
		spanErr = err
		h.writeError(w, r, http.StatusInternalServerError, ErrCodeConfigError,
			"Configuration error",
			fmt.Sprintf("Failed to get subscription ID: %v", err))
		return false
	}
	match := webhook.SubscriptionId == subscriptionID
	trace.SpanFromContext(ctx).SetAttributes(attribute.Bool("desirelines.subscription_match", match))
	if !match {
		spanErr = fmt.Errorf("subscription_id mismatch")
		h.writeError(w, r, http.StatusUnauthorized, ErrCodeInvalidSubscriptionID, "Invalid subscription_id", "")
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

// recordOwnerCheck increments the owner-allowlist-check counter labeled by
// the outcome (allowed / stray / orphan / error). No-op when no counter is
// configured. Used to drive a dashboard tile and the orphan-rate alert.
func (h *Handler) recordOwnerCheck(ctx context.Context, webhook *generated.WebhookEvent, result string) {
	if h.ownerCheckCounter == nil {
		return
	}
	h.ownerCheckCounter.Add(ctx, 1,
		metric.WithAttributes(
			attribute.String("result", result),
			attribute.String("aspect_type", webhookproto.AspectTypeToString(webhook.AspectType)),
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
//
// Two-stage owner check:
//
//  1. Allowlist guard — drop strays before any Strava API call. Non-allowlisted
//     athletes can still hold a Strava OAuth grant against this app (the
//     apigateway rejects the callback but Strava retains the grant), and
//     their webhooks will keep arriving until they revoke at strava.com.
//  2. Token presence — if the athlete is allowlisted but has no Firestore
//     tokens, that's an orphan: real bug worth alerting on.
//
// Any deauth/re-auth race may briefly land in the orphan branch while tokens
// are being rewritten; we ack so Strava stops retrying and the next event
// processes normally once the new tokens are written.
// shouldFetchActivity reports whether this event needs the full Strava activity
// fetched and attached as EnrichedEvent.RawActivity.
//
// CREATE always needs it. A type-change UPDATE needs it too: Strava's webhook
// carries only the broad `type` ("Ride"), not the granular `sport_type`
// ("MountainBikeRide") that downstream persists in the `sport` column — so we
// re-fetch to recover it. Title/private-only updates (and deletes) do not.
func shouldFetchActivity(webhook *generated.WebhookEvent) bool {
	switch webhook.AspectType {
	case generated.AspectType_ASPECT_TYPE_CREATE:
		return true
	case generated.AspectType_ASPECT_TYPE_UPDATE:
		u := webhook.GetUpdates()
		return u != nil && u.Type != nil
	default:
		return false
	}
}

func (h *Handler) handleActivityEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent, correlationID string) {
	enriched := &generated.EnrichedEvent{Event: webhook}

	// Track the owner-check outcome locally; defer the metric so each
	// request records exactly one result regardless of which branch returns.
	// Invariant: allowed + stray + orphan + error == total activity events.
	result := ownerCheckAllowed
	defer func() { h.recordOwnerCheck(ctx, webhook, result) }()

	ownerIDStr := strconv.FormatInt(webhook.OwnerId, 10)
	// Span makes the allowlist read self-documenting in traces. Without it,
	// the underlying firestore.DocumentRef.Get span is visible but its
	// purpose ("guard non-allowlisted owners") is not.
	allowCtx, allowSpanDone := sharedotel.StartSpan(ctx, h.tracer, "dispatcher.allowlist_check",
		attribute.Int64("owner_id", webhook.OwnerId),
	)
	allowed, allowErr := h.allowlist.IsAllowed(allowCtx, ownerIDStr)
	allowSpanDone(allowErr)
	switch {
	case allowErr != nil:
		// Fail-closed on transient allowlist errors: 500 so Strava retries.
		// Strava's 3-attempt cap bounds the damage; better than silently
		// dropping a legitimate user's event because Firestore had a hiccup.
		result = ownerCheckError
		h.writeError(w, r, http.StatusInternalServerError, ErrCodeAllowlistCheckFailed,
			"Allowlist check failed",
			fmt.Sprintf("Allowlist read failed for owner %d: %v", webhook.OwnerId, allowErr))
		return
	case !allowed:
		// Stray webhook — non-allowlisted athlete still has an active Strava
		// OAuth grant. Expected; ack quietly without calling Strava.
		result = ownerCheckStray
		h.logger.Info("Stray webhook for non-allowlisted owner, acknowledging",
			"correlation_id", correlationID,
			"owner_id", webhook.OwnerId,
			"object_id", webhook.ObjectId,
			"aspect_type", webhook.AspectType.String(),
		)
		h.writeAcknowledged(w)
		return
	}

	if shouldFetchActivity(webhook) {
		rawActivity, fetchErr := h.stravaClient.FetchActivity(ctx, webhook.OwnerId, webhook.ObjectId)
		switch {
		case fetchErr == nil:
			enriched.RawActivity = rawActivity
		case errors.Is(fetchErr, ports.ErrActivityNotFound):
			// Activity was deleted before we could fetch it — publish without
			// activity data. Downstream then degrades gracefully: a CREATE
			// records the deletion, a type-change UPDATE falls back to a bare
			// metadata update (no sport clobber).
			h.logger.Warn("Activity not found in Strava, publishing without activity data",
				"correlation_id", correlationID,
				"object_id", webhook.ObjectId)
		case errors.Is(fetchErr, ports.ErrTokenNotFound):
			// Orphan: athlete is allowlisted but has no Firestore tokens.
			// This is a real bug (Firestore wipe, deauth/re-auth race, etc.).
			// Ack so Strava stops retrying, but log ERROR so the alert fires.
			result = ownerCheckOrphan
			h.logger.Error("Orphan tokens — allowlisted athlete has no tokens, dropping event",
				"correlation_id", correlationID,
				"owner_id", webhook.OwnerId,
				"object_id", webhook.ObjectId,
			)
			h.writeAcknowledged(w)
			return
		default:
			// Other Strava errors — return 500 so Strava retries (up to 3
			// total attempts per spec).
			h.writeError(w, r, http.StatusInternalServerError, ErrCodeStravaFetchFailed,
				"Failed to fetch activity from Strava",
				fmt.Sprintf("Strava fetch failed: %v", fetchErr))
			return
		}
	}

	if publishErr := h.publisher.Publish(ctx, enriched, correlationID); publishErr != nil {
		h.writeError(w, r, http.StatusInternalServerError, ErrCodePublishFailed,
			"Failed to publish event",
			fmt.Sprintf("Publish failed: %v", publishErr))
		return
	}

	// Strictly after the primary publish has succeeded, and strictly unable to
	// change what happens next: see publishActivityRow.
	h.publishActivityRow(ctx, enriched, correlationID)

	h.writeSuccess(w)
}

// publishActivityRow publishes the activity as a BigQuery CDC row on the side.
// It is best-effort by construction and reports nothing back: no return value,
// no error, no effect on the response already headed for Strava. Whatever
// happens in here — a malformed payload, a dead topic, a panic — is logged,
// counted, and dropped, because the webhook has already been handled
// successfully by the time it runs. Callers must keep it that way.
//
// A nil rowPublisher means the feature is switched off, which is the default.
//
// It publishes synchronously, so it does spend webhook-response time: one more
// publish on a path that already makes one, bounded by whatever is left of
// handleEventDeadline. That fits inside Strava's 2s expectation with room to
// spare, and buys ordering that a detached goroutine would not — the row
// cannot overtake the primary event it followed.
func (h *Handler) publishActivityRow(ctx context.Context, enriched *generated.EnrichedEvent, correlationID string) {
	if h.rowPublisher == nil {
		return
	}
	webhook := enriched.Event

	// The row mapping walks arbitrary JSON from Strava. A panic there would
	// otherwise unwind through a handler that has already done its job — the
	// primary publish is committed and the 200 is about to be written — and
	// turn a successful webhook into a failed one.
	defer func() {
		if recovered := recover(); recovered != nil {
			h.recordRowPublish(ctx, webhook, rowPublishError, rowErrorPanic)
			h.logger.Error("Panic in activity-row publish, ignoring",
				"correlation_id", correlationID,
				"object_id", webhook.ObjectId,
				"panic", recovered)
		}
	}()

	body, changeType, skipReason, errDetail := h.buildActivityRow(ctx, enriched, correlationID)
	if skipReason != "" {
		h.recordRowPublish(ctx, webhook, rowPublishSkipped, skipReason)
		h.logger.Info("Skipping activity-row publish",
			"correlation_id", correlationID,
			"object_id", webhook.ObjectId,
			"aspect_type", webhookproto.AspectTypeToString(webhook.AspectType),
			"reason", skipReason)
		return
	}
	if errDetail != "" {
		// buildActivityRow already logged the failure.
		h.recordRowPublish(ctx, webhook, rowPublishError, errDetail)
		return
	}

	if err := h.rowPublisher.PublishRaw(ctx, body, correlationID); err != nil {
		h.recordRowPublish(ctx, webhook, rowPublishError, rowErrorPublish)
		h.logger.Error("Activity-row publish failed, ignoring",
			"correlation_id", correlationID,
			"object_id", webhook.ObjectId,
			"change_type", changeType,
			"error", err)
		return
	}

	h.recordRowPublish(ctx, webhook, rowPublishPublished, changeType)
	h.logger.Info("Published activity row",
		"correlation_id", correlationID,
		"object_id", webhook.ObjectId,
		"change_type", changeType)
}

// buildActivityRow maps a webhook event onto a CDC message body, re-fetching
// the activity when the event did not carry one. Exactly one of three outcomes
// is returned: a body with its change type, a skip reason for an event that
// legitimately produces no row, or an error detail naming what failed. Failures
// are logged here and counted by the caller.
func (h *Handler) buildActivityRow(ctx context.Context, enriched *generated.EnrichedEvent, correlationID string) (body []byte, changeType, skipReason, errDetail string) {
	webhook := enriched.Event
	// Section 2 of the sequence number orders events Strava stamped in the
	// same second; now() is the closest thing to their arrival order.
	sequenceNumber := bqrow.SequenceNumber(webhook.EventTime, time.Now())

	var err error
	switch webhook.AspectType {
	case generated.AspectType_ASPECT_TYPE_DELETE:
		body, err = bqrow.Delete(webhook.ObjectId, sequenceNumber)
		changeType = bqrow.ChangeTypeDelete
	case generated.AspectType_ASPECT_TYPE_CREATE, generated.AspectType_ASPECT_TYPE_UPDATE:
		rawActivity := enriched.RawActivity
		if rawActivity == nil && webhook.AspectType == generated.AspectType_ASPECT_TYPE_UPDATE {
			// A metadata-only edit — a rename, a visibility change, a photo
			// added — arrives with no activity payload, because the primary
			// pipeline can apply it from the webhook alone. A CDC upsert
			// replaces the whole row, so the row publish needs the complete
			// activity or it cannot publish at all.
			//
			// Fetched here rather than by widening shouldFetchActivity: that
			// would attach the payload to the primary envelope too, turning
			// every rename into a full PostgreSQL row upsert plus a region
			// retag. Keeping the extra call inside the best-effort block means
			// this feature cannot change what the source of truth receives.
			var fetchErr error
			rawActivity, fetchErr = h.fetchActivityForRow(ctx, webhook, correlationID)
			switch {
			case fetchErr == nil:
			case errors.Is(fetchErr, ports.ErrActivityNotFound):
				// Deleted between the webhook and the re-fetch. Nothing to
				// publish, and the DELETE that follows is what matters.
				return nil, "", rowSkipNoActivity, ""
			case errors.Is(fetchErr, ports.ErrTokenNotFound):
				// No tokens for this athlete — see rowSkipNoTokens.
				return nil, "", rowSkipNoTokens, ""
			default:
				// The activity still exists and Strava would not serve it.
				// An error, not a skip — see rowErrorRefetch.
				return nil, "", "", rowErrorRefetch
			}
		}
		if rawActivity == nil {
			// A CREATE whose fetch already found the activity gone.
			return nil, "", rowSkipNoActivity, ""
		}
		body, err = bqrow.Upsert(rawActivity, sequenceNumber)
		changeType = bqrow.ChangeTypeUpsert
	default:
		return nil, "", rowSkipUnsupportedAspect, ""
	}

	if err != nil {
		h.logger.Error("Failed to build activity row, ignoring",
			"object_id", webhook.ObjectId,
			"aspect_type", webhookproto.AspectTypeToString(webhook.AspectType),
			"error", err)
		return nil, "", "", rowErrorBuild
	}
	return body, changeType, "", ""
}

// fetchActivityForRow re-fetches an activity that its webhook did not carry, so
// a metadata-only edit can still produce a complete CDC row.
//
// The error is returned rather than flattened to nil because the caller has to
// tell two very different situations apart: an activity that no longer exists
// (nothing to publish, expected) from Strava refusing to serve one that does
// (the feature is failing). Logged at Warn either way — this runs after the
// webhook is already handled, and a missed row self-corrects on the next event
// carrying a payload.
func (h *Handler) fetchActivityForRow(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, h.rowRefetchTimeout)
	defer cancel()

	rawActivity, err := h.stravaClient.FetchActivity(ctx, webhook.OwnerId, webhook.ObjectId)
	if err != nil {
		h.logger.Warn("Activity re-fetch for row publish failed, skipping row",
			"correlation_id", correlationID,
			"object_id", webhook.ObjectId,
			"error", err)
		// %w, not %v: the caller classifies on ports.ErrActivityNotFound and a
		// flattened error would send every Strava outage down the "activity is
		// gone" branch.
		return nil, fmt.Errorf("re-fetch activity %d for row publish: %w", webhook.ObjectId, err)
	}
	return rawActivity, nil
}

// recordRowPublish increments the activity-row publish counter, labeled by
// outcome (published / skipped / error) and by a detail that reads differently
// per outcome: the change type for a publish, the reason otherwise. No-op when
// no counter is configured.
func (h *Handler) recordRowPublish(ctx context.Context, webhook *generated.WebhookEvent, result, detail string) {
	if h.rowPublishCounter == nil {
		return
	}
	h.rowPublishCounter.Add(ctx, 1,
		metric.WithAttributes(
			attribute.String("result", result),
			attribute.String("detail", detail),
			attribute.String("aspect_type", webhookproto.AspectTypeToString(webhook.AspectType)),
		),
	)
}

// handleAthleteEvent processes athlete-type webhook events.
//
// Per Strava webhook docs (https://developers.strava.com/docs/webhooks/),
// deauthorization is signaled via object_type=athlete with
// updates={"authorized":"false"} (or the bare boolean {"authorized":false},
// which we coerce below). We also handle aspect_type=delete defensively in case
// Strava sends that form.
//
// Deliberately NO allowlist gate (unlike handleActivityEvent). Deauth is
// cleanup, and cleanup must run regardless of *current* allowlist membership:
// an athlete who was allowlisted, is later removed, and then deauthorizes still
// has Firestore tokens + downstream data to purge. Gating on IsAllowed here
// would strand that data. A true stray (never allowlisted) has no tokens and no
// data, so the delete + publish are harmless no-ops — the deletion service is
// idempotent and the deauth-event volume is bounded. This is an intentional
// design decision (see TestHandler_OwnerCheck_DeauthBypassesAllowlist), not a
// missing guard; please don't "mirror the activity-path gate" here.
func (h *Handler) handleAthleteEvent(ctx context.Context, w http.ResponseWriter, r *http.Request, webhook *generated.WebhookEvent, body []byte) {
	correlationID := gcplog.CorrelationIDFromContext(ctx)

	var isDeauth bool
	switch webhook.AspectType {
	case generated.AspectType_ASPECT_TYPE_DELETE:
		isDeauth = true
	case generated.AspectType_ASPECT_TYPE_UPDATE:
		// The proto parser only handles activity updates, so inspect the raw JSON to
		// detect the athlete deauthorization update. Decode `updates` as RawMessage and
		// coerce so a bare boolean ({"authorized":false}) is detected too, not dropped
		// as a failed string unmarshal (which would leak the athlete's tokens).
		var payload struct {
			Updates map[string]any `json:"updates"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			h.logger.Warn("Failed to unmarshal athlete update payload",
				"correlation_id", correlationID,
				"error", err,
				"owner_id", webhook.OwnerId,
			)
		} else if raw, ok := payload.Updates["authorized"]; ok {
			if val, valid := webhookproto.CoerceToString(raw); valid && val == "false" {
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

	// No IsAllowed check on purpose — a confirmed deauth proceeds to delete +
	// publish regardless of allowlist membership. See the function doc comment
	// for why (cleanup must cover former members; strays are harmless no-ops).
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

	// Drop any cached allowlist decision for this owner. The deletion service
	// removes the allowlist doc out of process (a few seconds later), which this
	// in-process cache can't observe; without this a straggler webhook in the
	// window would read a stale allowed=true, find tokens gone, and trip the HIGH
	// orphan alert. No-ops when the checker isn't a caching one.
	if inv, ok := h.allowlist.(allowlist.Invalidator); ok {
		inv.Invalidate(strconv.FormatInt(webhook.OwnerId, 10))
	}

	// Publish to the dedicated deauth topic. CONTRACT: the deauth signal is the *topic
	// identity*, not the body — the published payload carries the athlete event (owner_id,
	// aspect/object type) but no explicit `authorized:false` flag. Consumers act on receipt
	// from this topic; they must not depend on inspecting the body for deauth intent (it's
	// detected here from the raw webhook and deliberately not propagated).
	enriched := &generated.EnrichedEvent{Event: webhook}
	if publishErr := h.deauthPublisher.Publish(ctx, enriched, correlationID); publishErr != nil {
		h.writeError(w, r, http.StatusInternalServerError, ErrCodeDeauthFailed,
			"Failed to publish deauth event",
			fmt.Sprintf("Publish failed: %v", publishErr))
		return
	}

	h.writeAcknowledged(w)
}

// webhookResponse is the JSON response for successful webhook processing.
type webhookResponse struct {
	Success bool   `json:"success"`
	Action  string `json:"action"`
}

// writeSuccess returns 200 OK when a message is published to Pub/Sub.
//
// This used to return 201 Created, to distinguish "published to Pub/Sub" from
// "acknowledged but ignored", on the assumption that Strava accepts any 2xx.
// It does not: Strava's spec says 200, and anything else is treated as a failed
// delivery. Prod request logs settled it — every 201 was redelivered three
// times at 120s intervals despite sub-second latency, while a 200 was accepted
// on the spot and never redelivered. Three deliveries meant triple the Strava
// API calls and triple the downstream writes for every event.
//
// The published-vs-acknowledged distinction lives in the response body's
// `action` field, which is where a caller that cares can still read it.
func (h *Handler) writeSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(http.StatusOK)
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
