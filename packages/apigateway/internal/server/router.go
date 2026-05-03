// Package server provides HTTP server setup, middleware, and response helpers.
//
// This is a read-only API - all endpoints are GET requests. Request body size limits
// are not needed because GET requests don't have bodies. Query parameters are validated
// individually with length limits (see pkg/validate).
package server

import (
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/metric"
)

// AuthMiddleware defines the interface for authentication middleware.
type AuthMiddleware interface {
	Middleware(next http.Handler) http.Handler
}

// RouterConfig holds the dependencies needed to configure routes.
type RouterConfig struct {
	CORSHandler     *cors.Handler
	AuthMiddleware  AuthMiddleware
	RateLimiter     *ratelimit.Limiter
	AuthRateLimiter *ratelimit.Limiter // applied only to /auth/*
	HTTPHistogram   metric.Float64Histogram
}

// PublicRoutes are registered without authentication.
type PublicRoutes struct {
	Health       http.HandlerFunc
	Ready        http.HandlerFunc
	SportConfig  http.HandlerFunc
	AuthInitiate http.HandlerFunc // GET /auth/strava
	AuthCallback http.HandlerFunc // GET /auth/callback
}

// AuthenticatedRoutes are registered with authentication middleware.
type AuthenticatedRoutes struct {
	GetMetadata     http.HandlerFunc
	GetMetrics      http.HandlerFunc
	GetSource       http.HandlerFunc
	GetRoutes       http.HandlerFunc
	ListActivities  http.HandlerFunc
	GetActivityByID http.HandlerFunc
}

// NewRouter creates a configured chi router with all routes registered.
func NewRouter(cfg RouterConfig, public PublicRoutes, auth AuthenticatedRoutes, logger *slog.Logger) chi.Router {
	r := chi.NewRouter()

	// Essential middleware
	r.Use(chiMiddleware.RequestID)
	r.Use(gcplog.BridgeRequestID)
	r.Use(gcplog.CloudRunRealIP)
	if cfg.RateLimiter != nil {
		r.Use(cfg.RateLimiter.Middleware)
	}
	r.Use(gcplog.WithCloudTraceContext)
	r.Use(otel.SpanNameFromChiRoute)
	r.Use(otel.StampRequestID)
	r.Use(gcplog.HTTPRequestLoggerWithMetrics(logger, cfg.HTTPHistogram))
	r.Use(chiMiddleware.Recoverer)

	// Security and CORS headers for all routes
	r.Use(SecurityHeaders)
	r.Use(CORSMiddleware(cfg.CORSHandler))

	// Root-level endpoints (health checks)
	r.Get("/health", public.Health)
	r.Get("/ready", public.Ready)

	// Auth routes get a stricter per-IP rate limiter on top of the global one.
	// This is defense-in-depth on the most expensive-per-call endpoints in the
	// API (Strava API + Firestore + Firebase custom-token mint).
	r.Route("/auth", func(r chi.Router) {
		if cfg.AuthRateLimiter != nil {
			r.Use(cfg.AuthRateLimiter.Middleware)
		}
		r.Get("/strava", public.AuthInitiate)
		r.Get("/callback", public.AuthCallback)
	})

	// Versioned API routes
	r.Route("/v1", func(r chi.Router) {
		// Public endpoints (no auth required)
		r.Get("/sports/config", public.SportConfig)

		// Authenticated route group
		r.Group(func(r chi.Router) {
			r.Use(cfg.AuthMiddleware.Middleware)
			r.Use(NoCacheHeaders)

			// Multi-sport endpoints (PostgreSQL backed)
			r.Get("/activities/{year}/metadata", auth.GetMetadata)
			r.Get("/activities/{year}/metrics", auth.GetMetrics)
			r.Get("/activities/{year}/source", auth.GetSource)

			// Route art endpoint (must be registered before {id} to avoid chi matching "routes" as an ID)
			r.Get("/activities/routes", auth.GetRoutes)

			// Individual activity endpoints
			// Note: {id} occupies the same path segment as {year} above, but the
			// {year} routes all require a sub-path (/metadata, /metrics, /source).
			// Strava IDs are 10+ digits, so no practical collision with 4-digit years.
			r.Get("/activities", auth.ListActivities)
			r.Get("/activities/{id}", auth.GetActivityByID)
		})
	})

	return r
}
