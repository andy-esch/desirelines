package gcplog

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// HTTPRequestLogger is a middleware that logs structured request information using slog.
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
				// Get request ID from chi context
				requestID := middleware.GetReqID(r.Context())

				attrs := []any{
					"method", r.Method,
					"path", r.URL.Path,
					"status", status,
					"duration", time.Since(start),
					"bytes", ww.BytesWritten(),
					"request_id", requestID,
					"remote_ip", r.RemoteAddr,
					"user_agent", r.UserAgent(),
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
