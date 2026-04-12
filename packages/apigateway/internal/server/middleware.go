// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
)

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
		w.Header().Set("X-Content-Type-Options", "nosniff")
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
