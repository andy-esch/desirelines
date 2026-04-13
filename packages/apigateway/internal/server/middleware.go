// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"net/http"
	"strings"

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

// StripOptionalPrefix returns a handler that strips the given prefix from the
// request URL path if present, then delegates to the inner handler. Unlike
// http.StripPrefix, paths without the prefix are passed through unchanged
// instead of returning 404.
//
// This supports serving the API under two path spaces simultaneously: requests
// to /v1/... route directly, and requests to /api/v1/... have /api stripped
// before routing. This is used behind Firebase Hosting Cloud Run rewrites,
// which forward the full original path (including the rewrite prefix) to the
// backend.
func StripOptionalPrefix(prefix string, h http.Handler) http.Handler {
	if prefix == "" {
		return h
	}
	stripped := http.StripPrefix(prefix, h)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only strip when the prefix is followed by a path segment boundary
		// ("/api/..." or exactly "/api"). This avoids rewriting paths like
		// "/apistuff" that merely share a prefix string.
		if strings.HasPrefix(r.URL.Path, prefix+"/") || r.URL.Path == prefix {
			stripped.ServeHTTP(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}
