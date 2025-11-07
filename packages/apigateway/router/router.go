// Package router provides HTTP request routing for the API Gateway.
package router

import (
	"log"
	"net/http"
	"strings"
)

// Handler is a function that handles HTTP requests.
type Handler func(w http.ResponseWriter, r *http.Request)

// Router manages HTTP request routing with optional authentication.
type Router struct {
	routes map[string]Route
}

// Route represents a configured route with its handler and middleware.
type Route struct {
	Handler        Handler
	RequiresAuth   bool
	AuthMiddleware func(http.Handler) http.Handler
}

// NewRouter creates a new router instance.
func NewRouter() *Router {
	return &Router{
		routes: make(map[string]Route),
	}
}

// RegisterRoute registers a route with its handler and authentication requirement.
func (rt *Router) RegisterRoute(pattern string, handler Handler, requiresAuth bool, authMiddleware func(http.Handler) http.Handler) {
	rt.routes[pattern] = Route{
		Handler:        handler,
		RequiresAuth:   requiresAuth,
		AuthMiddleware: authMiddleware,
	}
}

// Route routes an incoming request to the appropriate handler.
// Returns true if route was found and handled, false otherwise.
func (rt *Router) Route(w http.ResponseWriter, r *http.Request, path string) bool {
	log.Printf("API request: %s %s", r.Method, path)

	// Try exact match first
	if route, ok := rt.routes[path]; ok {
		rt.handleRoute(w, r, path, route)
		return true
	}

	// Try prefix matching for dynamic routes (e.g., "activities/*")
	for pattern, route := range rt.routes {
		if strings.HasSuffix(pattern, "*") {
			prefix := strings.TrimSuffix(pattern, "*")
			if strings.HasPrefix(path, prefix) {
				rt.handleRoute(w, r, path, route)
				return true
			}
		}
	}

	return false
}

// handleRoute processes a matched route with optional authentication.
func (rt *Router) handleRoute(w http.ResponseWriter, r *http.Request, _ string, route Route) {
	if route.RequiresAuth && route.AuthMiddleware != nil {
		// Wrap handler with authentication middleware
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			route.Handler(w, r)
		})
		route.AuthMiddleware(handler).ServeHTTP(w, r)
	} else {
		// Call handler directly (no auth required)
		route.Handler(w, r)
	}
}
