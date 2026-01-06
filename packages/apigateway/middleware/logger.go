package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// Logger is a middleware that logs structured request information using slog.
func Logger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap the response writer to capture the status code
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			defer func() {
				// Get request ID from chi context
				requestID := middleware.GetReqID(r.Context())

				// Log completion
				logger.Info("HTTP Request",
					"method", r.Method,
					"path", r.URL.Path,
					"status", ww.Status(),
					"duration", time.Since(start),
					"request_id", requestID,
					"remote_ip", r.RemoteAddr,
					"user_agent", r.UserAgent(),
				)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}
