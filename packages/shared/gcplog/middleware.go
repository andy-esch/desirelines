package gcplog

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// traceContextKey is the context key for trace information.
type traceContextKey struct{}

// TraceContext holds GCP trace correlation information.
type TraceContext struct {
	TraceID      string
	SpanID       string
	TraceSampled bool
}

// HTTPRequestLogger is a middleware that logs structured request information using slog.
// It formats the httpRequest field according to GCP Cloud Logging specifications,
// enabling parent-child log hierarchy in the Cloud Console.
//
// Log levels are based on response status:
//   - 5xx errors: ERROR
//   - 4xx errors: WARN
//   - All others: INFO
func HTTPRequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return requestLogger(logger, nil)
}

// HTTPRequestLoggerWithMetrics is a variant of HTTPRequestLogger that also records
// request duration to an OpenTelemetry histogram. The histogram is recorded with
// http.method, http.status_code, and http.route attributes.
//
// The http.route attribute uses chi's RouteContext for low-cardinality route patterns
// (e.g., "/activities/{id}") rather than the actual URL path.
func HTTPRequestLoggerWithMetrics(logger *slog.Logger, histogram metric.Float64Histogram) func(http.Handler) http.Handler {
	return requestLogger(logger, histogram)
}

// requestLogger is the shared implementation for both HTTPRequestLogger and
// HTTPRequestLoggerWithMetrics. When histogram is non-nil, it records request
// duration as an OTel metric.
func requestLogger(logger *slog.Logger, histogram metric.Float64Histogram) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap the response writer to capture the status code and bytes written
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			//nolint:contextcheck // logger/histogram deliberately use the request context inside defer to preserve trace/correlation IDs; cancellation on client disconnect is acceptable for post-request metrics
			defer func() {
				status := ww.Status()
				latency := time.Since(start)

				// Build httpRequest field per GCP spec.
				// Log only the URL path — never the query string, which may
				// contain secrets (e.g. hub.verify_token on the webhook endpoint).
				httpRequest := slog.Group("httpRequest",
					"requestMethod", r.Method,
					"requestUrl", r.URL.Path,
					"status", status,
					"responseSize", ww.BytesWritten(),
					"userAgent", r.UserAgent(),
					"remoteIp", r.RemoteAddr,
					"latency", formatLatency(latency),
					"protocol", r.Proto,
				)

				// Get request ID from chi context (if available)
				requestID := middleware.GetReqID(r.Context())

				attrs := []any{httpRequest}
				if requestID != "" {
					attrs = append(attrs, "request_id", requestID)
				}

				// Add trace context if available
				if tc := GetTraceContext(r.Context()); tc != nil {
					attrs = append(attrs,
						"logging.googleapis.com/trace", tc.TraceID,
						"logging.googleapis.com/spanId", tc.SpanID,
						"logging.googleapis.com/trace_sampled", tc.TraceSampled,
					)
				}

				// Log at appropriate level based on status code
				switch {
				case status >= 500:
					logger.Error("HTTP Request", attrs...)
				case status >= 400:
					logger.Warn("HTTP Request", attrs...)
				default:
					logger.Info("HTTP Request", attrs...)
				}

				// Record OTel histogram if provided.
				//
				// Skip /health and /ready: GCP uptime checks (multi-region,
				// every 60s) and Cloud Scheduler readiness probes hit these
				// paths constantly. Their sub-1ms latencies would drag the
				// histogram P50 down and pollute bucket distribution without
				// telling us anything diagnostic. Mirrors the OTel trace
				// filter at packages/apigateway/cmd/apigateway/main.go (see
				// otelhttp.WithFilter call) — note that filter sees the
				// public path (/api/health) while this one runs inside chi
				// after http.StripPrefix("/api", ...) and sees the bare path
				// (/health, /ready).
				if histogram != nil && !isProbePath(r.URL.Path) {
					route := "unknown"
					if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.RoutePattern() != "" {
						route = rctx.RoutePattern()
					}
					histogram.Record(r.Context(), float64(latency.Milliseconds()),
						metric.WithAttributes(
							attribute.String("http.method", r.Method),
							attribute.String("http.status_code", strconv.Itoa(status)),
							attribute.String("http.route", route),
						),
					)
				}
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// WithCloudTraceContext is middleware that extracts trace context from incoming
// requests and adds it to the request context for log correlation.
//
// It prefers the active OpenTelemetry span so logs carry the same trace_id that
// OTel propagates to downstream services. If no span is present it falls back to
// parsing the X-Cloud-Trace-Context (GCP) or traceparent (W3C) headers directly.
//
// The trace context can be retrieved using GetTraceContext and is automatically
// included in logs when using HTTPRequestLogger.
func WithCloudTraceContext(next http.Handler) http.Handler {
	// Get project ID once at startup (empty string if not on GCP)
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		projectID = os.Getenv("GCP_PROJECT")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tc := extractTraceContext(r, projectID)
		if tc != nil {
			ctx := context.WithValue(r.Context(), traceContextKey{}, tc)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// GetTraceContext retrieves the trace context from the request context.
// Returns nil if no trace context is available.
func GetTraceContext(ctx context.Context) *TraceContext {
	// No explicit val == nil pre-check: a nil interface asserts to (nil, false),
	// which the ok branch already handles.
	tc, ok := ctx.Value(traceContextKey{}).(*TraceContext)
	if !ok {
		return nil
	}
	return tc
}

// extractTraceContext parses trace information from the request context or headers.
//
// It first checks for an active OpenTelemetry span in the context. If found, it
// uses that trace and span ID to ensure consistency between OTel and logs.
//
// If no OTel span is present, it falls back to manual extraction from
// X-Cloud-Trace-Context (GCP) or traceparent (W3C) headers.
func extractTraceContext(r *http.Request, projectID string) *TraceContext {
	// 1. Try active OTel span first to ensure consistency
	if span := trace.SpanFromContext(r.Context()); span.SpanContext().IsValid() {
		sc := span.SpanContext()
		traceID := sc.TraceID().String()
		spanID := sc.SpanID().String()
		traceSampled := sc.IsSampled()

		return &TraceContext{
			TraceID:      formatTraceID(traceID, projectID),
			SpanID:       spanID,
			TraceSampled: traceSampled,
		}
	}

	// 2. Fall back to manual header extraction if no OTel span exists
	// Try GCP's X-Cloud-Trace-Context first
	// Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
	if header := r.Header.Get("X-Cloud-Trace-Context"); header != "" {
		return parseCloudTraceContext(header, projectID)
	}

	// 3. Fall back to W3C traceparent
	// Format: VERSION-TRACE_ID-SPAN_ID-FLAGS
	if header := r.Header.Get("traceparent"); header != "" {
		return parseTraceparent(header, projectID)
	}

	return nil
}

// parseCloudTraceContext parses GCP's X-Cloud-Trace-Context header.
// Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
func parseCloudTraceContext(header, projectID string) *TraceContext {
	// Split off the options (;o=...). strings.Split always returns ≥1
	// element, so no len==0 guard is needed.
	parts := strings.Split(header, ";")

	// Parse trace sampled flag
	traceSampled := false
	for _, part := range parts[1:] {
		if strings.HasPrefix(part, "o=") {
			traceSampled = strings.TrimPrefix(part, "o=") == "1"
			break
		}
	}

	// Split TRACE_ID/SPAN_ID
	idParts := strings.Split(parts[0], "/")
	if idParts[0] == "" {
		return nil
	}

	traceID := idParts[0]
	var spanID string
	if len(idParts) > 1 {
		spanID = idParts[1]
	}

	return &TraceContext{
		TraceID:      formatTraceID(traceID, projectID),
		SpanID:       spanID,
		TraceSampled: traceSampled,
	}
}

// parseTraceparent parses W3C's traceparent header.
// Format: VERSION-TRACE_ID-SPAN_ID-FLAGS (e.g., 00-xxx-yyy-01)
func parseTraceparent(header, projectID string) *TraceContext {
	parts := strings.Split(header, "-")
	if len(parts) < 4 {
		return nil
	}

	traceID := parts[1]
	spanID := parts[2]
	flags := parts[3]

	// Check if sampled (last bit of flags)
	traceSampled := flags != "" && (flags[len(flags)-1] == '1')

	return &TraceContext{
		TraceID:      formatTraceID(traceID, projectID),
		SpanID:       spanID,
		TraceSampled: traceSampled,
	}
}

// formatTraceID returns the trace ID in GCP resource-name form
// ("projects/<id>/traces/<trace>") when projectID is set, otherwise the raw
// trace ID. Cloud Logging's logging.googleapis.com/trace field expects the
// resource-name form for log/trace correlation in the Cloud Console.
func formatTraceID(traceID, projectID string) string {
	if projectID == "" {
		return traceID
	}
	return fmt.Sprintf("projects/%s/traces/%s", projectID, traceID)
}

// CloudRunRealIP is middleware that sets r.RemoteAddr to the real client IP.
//
// On Cloud Run (behind Google Front End / GCLB), Google's infrastructure appends the
// real client IP to the end of X-Forwarded-For. An attacker can prepend arbitrary IPs,
// so we must use the rightmost (last) entry — the one added by trusted infrastructure.
//
// This replaces chiMiddleware.RealIP which trusts the leftmost IP and is therefore
// vulnerable to spoofing behind reverse proxies that append.
func CloudRunRealIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// X-Forwarded-For: <client-supplied>, ..., <real-client-ip>
			// Take the rightmost entry (added by Google's infrastructure).
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				r.RemoteAddr = ip
			}
		}
		next.ServeHTTP(w, r)
	})
}

// BridgeRequestID is middleware that copies chi's request ID into the apierrors
// context key, allowing WriteError to read it without importing chi directly.
// Place this after chi's middleware.RequestID in the middleware stack.
func BridgeRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := middleware.GetReqID(r.Context()); id != "" {
			ctx := apierrors.WithRequestID(r.Context(), id)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// formatLatency formats a duration as a string suitable for GCP's latency field.
// GCP expects format like "0.123s" or "1.5s".
func formatLatency(d time.Duration) string {
	return fmt.Sprintf("%.9fs", d.Seconds())
}

// isProbePath reports whether the path is a Cloud Run / GCP uptime probe
// endpoint that we want to exclude from the request-duration histogram. The
// paths are post-StripPrefix ("/health", "/ready") because this middleware
// runs inside chi.
func isProbePath(path string) bool {
	return path == "/health" || path == "/ready"
}
