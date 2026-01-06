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
