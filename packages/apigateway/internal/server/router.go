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

	// EnableSyntheticFaults gates the synthetic-fault routes in
	// `internal/synthetic` — when true, `/v1/__synthetic_fault__` is
	// wired for SLO + security-alert rehearsal. Should be FALSE in
	// production: the route literally doesn't appear in the chi route
	// table when this is off. Production callers receive 404 (no
	// route), not 500.
	EnableSyntheticFaults bool
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

	// SyntheticFault is registered only when EnableSyntheticFaults is
	// true (typically: any non-production environment). When non-nil
	// and enabled, it's wired at `/v1/__synthetic_fault__` for
	// validating that the SLO burn-rate alerts AND the per-response-
	// code security alerts actually fire. Accepts an optional
	// `?code=N` query param to choose which response code to return;
	// see `internal/synthetic/handler.go` for the allowed-code list
	// and removal instructions.
	SyntheticFault http.HandlerFunc
}

// NewRouter creates a configured chi router with all routes registered.
//
// The returned router assumes the caller wraps it in otelhttp.NewHandler so
// the OTel-dependent middleware (otel.SpanNameFromChiRoute, otel.StampRequestID)
// has an active server span — without that wrap they silently no-op and traces
// disappear. The wrap lives at the composition root (cmd/apigateway/main.go)
// rather than here because it must sit OUTSIDE http.StripPrefix("/api", ...)
// so otelhttp's WithFilter can match the public path (/api/health, /api/ready)
// before chi sees the stripped path.
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

			// Synthetic-fault endpoint for SLO alert rehearsal. Conditional
			// registration ensures it doesn't appear in the prod route table
			// at all — see `internal/synthetic/handler.go` for context +
			// removal steps. Auth-gated so random internet callers can't
			// burn the SLO budget; only the developer (logged in) can hit it.
			if cfg.EnableSyntheticFaults && auth.SyntheticFault != nil {
				r.Get("/__synthetic_fault__", auth.SyntheticFault)
			}
		})
	})

	return r
}
