package otel

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/trace"
)

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
