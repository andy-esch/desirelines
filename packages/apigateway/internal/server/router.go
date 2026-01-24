// Package server provides HTTP server setup, middleware, and response helpers.
package server

import (
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// AuthMiddleware defines the interface for authentication middleware.
type AuthMiddleware interface {
	Middleware(next http.Handler) http.Handler
}

// RouterConfig holds the dependencies needed to configure routes.
type RouterConfig struct {
	CORSHandler    *cors.Handler
	AuthMiddleware AuthMiddleware
}

// PublicRoutes are registered without authentication.
type PublicRoutes struct {
	Health      http.HandlerFunc
	SportConfig http.HandlerFunc
}

// AuthenticatedRoutes are registered with authentication middleware.
type AuthenticatedRoutes struct {
	GetMetadata     http.HandlerFunc
	GetMetrics      http.HandlerFunc
	GetSource       http.HandlerFunc
	ListActivities  http.HandlerFunc
	GetActivityByID http.HandlerFunc
}

// NewRouter creates a configured chi router with all routes registered.
func NewRouter(cfg RouterConfig, public PublicRoutes, auth AuthenticatedRoutes, logger *slog.Logger) chi.Router {
	r := chi.NewRouter()

	// Essential middleware
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(gcplog.HTTPRequestLogger(logger))
	r.Use(chiMiddleware.Recoverer)

	// CORS middleware for all routes
	r.Use(CORSMiddleware(cfg.CORSHandler))

	// Public endpoints (no auth required)
	r.Get("/health", public.Health)
	r.Get("/sports/config", public.SportConfig)

	// Authenticated route group
	r.Group(func(r chi.Router) {
		r.Use(cfg.AuthMiddleware.Middleware)

		// Multi-sport endpoints (PostgreSQL backed)
		r.Get("/activities/{year}/metadata", auth.GetMetadata)
		r.Get("/activities/{year}/metrics", auth.GetMetrics)
		r.Get("/activities/{year}/source", auth.GetSource)

		// Individual activity endpoints
		r.Get("/activities", auth.ListActivities)
		r.Get("/activities/{id}", auth.GetActivityByID)
	})

	return r
}
