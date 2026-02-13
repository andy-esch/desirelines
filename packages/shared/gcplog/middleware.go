package gcplog

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
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
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap the response writer to capture the status code and bytes written
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			defer func() {
				status := ww.Status()
				latency := time.Since(start)

				// Build httpRequest field per GCP spec
				httpRequest := slog.Group("httpRequest",
					"requestMethod", r.Method,
					"requestUrl", r.URL.String(),
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
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// WithCloudTraceContext is middleware that extracts trace context from incoming
// requests and adds it to the request context for log correlation.
//
// It supports both GCP's X-Cloud-Trace-Context header and W3C's traceparent header.
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
	val := ctx.Value(traceContextKey{})
	if val == nil {
		return nil
	}
	tc, ok := val.(*TraceContext)
	if !ok {
		return nil
	}
	return tc
}

// extractTraceContext parses trace information from request headers.
// Supports X-Cloud-Trace-Context (GCP) and traceparent (W3C) headers.
func extractTraceContext(r *http.Request, projectID string) *TraceContext {
	// Try GCP's X-Cloud-Trace-Context first
	// Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
	if header := r.Header.Get("X-Cloud-Trace-Context"); header != "" {
		return parseCloudTraceContext(header, projectID)
	}

	// Fall back to W3C traceparent
	// Format: VERSION-TRACE_ID-SPAN_ID-FLAGS
	if header := r.Header.Get("traceparent"); header != "" {
		return parseTraceparent(header, projectID)
	}

	return nil
}

// parseCloudTraceContext parses GCP's X-Cloud-Trace-Context header.
// Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
func parseCloudTraceContext(header, projectID string) *TraceContext {
	// Split off the options (;o=...)
	parts := strings.Split(header, ";")
	if len(parts) == 0 {
		return nil
	}

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
	if len(idParts) == 0 || idParts[0] == "" {
		return nil
	}

	traceID := idParts[0]
	var spanID string
	if len(idParts) > 1 {
		spanID = idParts[1]
	}

	// Format trace ID as resource name if project ID is available
	fullTraceID := traceID
	if projectID != "" {
		fullTraceID = fmt.Sprintf("projects/%s/traces/%s", projectID, traceID)
	}

	return &TraceContext{
		TraceID:      fullTraceID,
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

	// Format trace ID as resource name if project ID is available
	fullTraceID := traceID
	if projectID != "" {
		fullTraceID = fmt.Sprintf("projects/%s/traces/%s", projectID, traceID)
	}

	return &TraceContext{
		TraceID:      fullTraceID,
		SpanID:       spanID,
		TraceSampled: traceSampled,
	}
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

// formatLatency formats a duration as a string suitable for GCP's latency field.
// GCP expects format like "0.123s" or "1.5s".
func formatLatency(d time.Duration) string {
	return fmt.Sprintf("%.9fs", d.Seconds())
}
