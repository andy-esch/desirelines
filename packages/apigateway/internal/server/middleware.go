// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
)

// RecoverOutermost turns a panic in the middleware that run before chi's
// Recoverer into the standard JSON 500. Recoverer sits innermost so the request
// logger can record the 500 it writes; a panic above it (RealIP, the security
// headers, CORS, the limiter) would otherwise reach net/http, which logs it as
// unstructured text and drops the connection. This guard logs the panic with
// its stack, writes the 500 if nothing has been written yet, and records the
// request in the histogram the request logger feeds, with the same attributes,
// so the failure counts where every other 500 does.
func RecoverOutermost(logger *slog.Logger, histogram metric.Float64Histogram) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chiMiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			//nolint:contextcheck // the 500 and the histogram deliberately use the request context, as the request logger's own deferred recorder does
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// net/http's own abort signal, which chi's Recoverer passes on too.
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec) //nolint:forbidigo // passes net/http's abort signal on, as chi's Recoverer does, so the server aborts the response quietly
				}
				logger.Error("Recovered a panic outside the request logger",
					"panic", fmt.Sprint(rec),
					"stack", string(debug.Stack()),
					"method", r.Method,
					"path", r.URL.Path)
				if ww.Status() == 0 {
					apierrors.WriteError(ww, r, apierrors.NewAPIError(http.StatusInternalServerError, "Internal server error"), logger)
				}
				if histogram != nil {
					histogram.Record(r.Context(), float64(time.Since(start).Milliseconds()),
						metric.WithAttributes(
							attribute.String("http.method", r.Method),
							attribute.String("http.status_code", strconv.Itoa(http.StatusInternalServerError)),
							attribute.String("http.route", "unknown"),
						),
					)
				}
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// CORSMiddleware wraps a CORS handler as HTTP middleware.
// It handles preflight OPTIONS requests and sets CORS headers for all responses.
func CORSMiddleware(corsHandler *cors.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Handle CORS preflight
			if r.Method == http.MethodOptions {
				corsHandler.HandlePreflight(w, r)
				return
			}

			// Set CORS headers for all requests
			corsHandler.SetHeaders(w, r)

			// Continue to next handler
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders sets baseline security headers on all responses.
// Cloud Run enforces HTTPS at the infrastructure level, but HSTS tells browsers
// to never attempt HTTP in the first place (defense-in-depth against downgrade).
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		next.ServeHTTP(w, r)
	})
}

// NoCacheHeaders sets Cache-Control: no-store on responses to prevent caching
// of authenticated data in shared caches or browser back/forward caches.
func NoCacheHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
