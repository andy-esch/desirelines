package otel

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// chiURLParamPrefix is the namespace for route-param attributes added to spans
// via AddChiURLParams. Keeping a stable, project-scoped prefix avoids collisions
// with OTel semantic-convention keys and makes the source legible in Cloud Trace
// (e.g. "desirelines.year=2024" vs an unprefixed "year").
const chiURLParamPrefix = "desirelines."

// SpanNameFromChiRoute is middleware that renames the active OpenTelemetry span
// using the chi route pattern once routing has matched, producing low-cardinality
// span names like "GET /v1/activities/{year}/metadata" instead of high-cardinality
// path-based names like "GET /v1/activities/2024/metadata".
//
// It must be placed inside the chi middleware chain (not outside the router)
// because chi populates RouteContext.RoutePattern during request dispatch.
// Place it after chi's core routing middleware and ideally before any middleware
// that reads the span (so the final name is visible everywhere downstream).
//
// If no OTel span is active or chi did not match a route (e.g. 404), the span
// name is left untouched.
func SpanNameFromChiRoute(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		//nolint:contextcheck // defer deliberately reads the request context to resolve the matched chi route pattern after dispatch; span renaming must happen post-handler and tolerate client-canceled contexts
		defer func() {
			span := trace.SpanFromContext(r.Context())
			if !span.SpanContext().IsValid() {
				return
			}
			rctx := chi.RouteContext(r.Context())
			if rctx == nil || rctx.RoutePattern() == "" {
				return
			}
			span.SetName(r.Method + " " + rctx.RoutePattern())
		}()
		next.ServeHTTP(w, r)
	})
}

// AddChiURLParams reads the named chi URL params from the request and sets
// each non-empty value as a `desirelines.<param>` attribute on the active
// OpenTelemetry span. Empty values are skipped (the route may not declare the
// param), and a no-op if there is no active span — so callers can invoke this
// unconditionally from a handler without a span guard.
//
// Use AddChiURLParamsAs when the chi param name should not be the attribute
// suffix (e.g. route param `{id}` → attribute `desirelines.activity_id` so a
// single Cloud Trace filter matches across services that name the same
// concept differently).
//
// Usage in a handler:
//
//	otel.AddChiURLParams(r, "year")        // /v1/activities/{year}/metadata
func AddChiURLParams(r *http.Request, params ...string) {
	span := trace.SpanFromContext(r.Context())
	if !span.SpanContext().IsValid() {
		return
	}
	attrs := make([]attribute.KeyValue, 0, len(params))
	for _, p := range params {
		v := chi.URLParam(r, p)
		if v == "" {
			continue
		}
		attrs = append(attrs, attribute.String(chiURLParamPrefix+p, v))
	}
	if len(attrs) > 0 {
		span.SetAttributes(attrs...)
	}
}

// AddChiURLParamsAs reads the keyed chi URL params and stamps each non-empty
// value on the active span as `desirelines.<value-of-aliases-map>`. Use this
// when the chi route param name is part of the public URL contract but the
// span attribute should follow a cross-service naming convention.
//
// Convention reminder: dispatcher stamps webhook fields as
// `desirelines.activity_id` and `desirelines.athlete_id` — apigateway should
// match those names so a Cloud Trace filter like `desirelines.activity_id=42`
// finds spans from both services.
//
// Usage in a handler:
//
//	// /v1/activities/{id} — `{id}` is the public URL surface, but we want the
//	// span attribute to be `desirelines.activity_id` (matches dispatcher).
//	otel.AddChiURLParamsAs(r, map[string]string{"id": "activity_id"})
func AddChiURLParamsAs(r *http.Request, aliases map[string]string) {
	span := trace.SpanFromContext(r.Context())
	if !span.SpanContext().IsValid() {
		return
	}
	attrs := make([]attribute.KeyValue, 0, len(aliases))
	for param, alias := range aliases {
		v := chi.URLParam(r, param)
		if v == "" {
			continue
		}
		attrs = append(attrs, attribute.String(chiURLParamPrefix+alias, v))
	}
	if len(attrs) > 0 {
		span.SetAttributes(attrs...)
	}
}

// StampRequestID is middleware that copies the chi-generated request ID (already
// bridged into the request context by gcplog.BridgeRequestID) onto the active
// OpenTelemetry server span as `request_id`.
//
// Naming is deliberate: the same `request_id` field appears in Cloud Logging
// log lines via gcplog's request logger, so a single Cloud Trace filter
// `request_id=<id>` and a Cloud Logging filter `jsonPayload.request_id=<id>`
// match the same value — no semantic-conventions key (`http.request.id`) is
// used because it would split the search surface.
//
// Place this middleware AFTER chi middleware.RequestID + gcplog.BridgeRequestID
// so the ID is present in context, and inside the otelhttp wrapper so a server
// span exists when the attribute is set. No-op if no valid span is active.
func StampRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		span := trace.SpanFromContext(r.Context())
		if span.SpanContext().IsValid() {
			if id := apierrors.RequestIDFromContext(r.Context()); id != "" {
				span.SetAttributes(attribute.String("request_id", id))
			}
		}
		next.ServeHTTP(w, r)
	})
}
