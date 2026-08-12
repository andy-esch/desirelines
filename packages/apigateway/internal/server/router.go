// Package server provides HTTP server setup, middleware, and response helpers.
//
// This is a read-only API - all endpoints are GET requests. Request body size limits
// are not needed because GET requests don't have bodies. Query parameters are validated
// individually with length limits (see pkg/validate).
package server

import (
	"log/slog"
	"net/http"
	"strings"

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
	CORSHandler    *cors.Handler
	AuthMiddleware AuthMiddleware
	// ReadinessMiddleware protects the DB-touching /ready endpoint with
	// service-to-service OIDC. It may be nil only in local development/tests.
	ReadinessMiddleware AuthMiddleware
	RateLimiter         *ratelimit.Limiter
	AuthRateLimiter     *ratelimit.Limiter // applied only to /auth/*
	TileRateLimiter     *ratelimit.Limiter // applied only to the bursty MVT tile route
	HTTPHistogram       metric.Float64Histogram

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
	Health            http.HandlerFunc
	Ready             http.HandlerFunc
	SportConfig       http.HandlerFunc
	AuthInitiate      http.HandlerFunc // GET /auth/strava (canonical-host redirect)
	AuthInitiateStart http.HandlerFunc // GET /auth/strava/start (state minting)
	AuthCallback      http.HandlerFunc // GET /auth/callback
}

// AuthenticatedRoutes are registered with authentication middleware.
type AuthenticatedRoutes struct {
	GetMetadata        http.HandlerFunc
	GetMetrics         http.HandlerFunc
	GetSource          http.HandlerFunc
	GetMapTile         http.HandlerFunc // GET /activities/map/tiles/{z}/{x}/{y}
	GetMapTileJSON     http.HandlerFunc // GET /activities/map/tiles.json
	GetMapRegions      http.HandlerFunc // GET /activities/map/regions
	GetMapDataset      http.HandlerFunc // GET /activities/map/dataset
	ListActivities     http.HandlerFunc
	GetActivitySummary http.HandlerFunc // GET /activities/summary
	GetActivityByID    http.HandlerFunc

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

// TilePathPrefix is the URL path of the MVT vector-tile route. Tile traffic has a
// fundamentally different request profile from the JSON API — a single slippy-map
// viewport requests many tiles at once — so the global per-IP limiter skips this
// prefix (see IsTileRequest) and a dedicated, higher-burst limiter is scoped to
// the route in NewRouter. This keeps the JSON/auth limiter posture untouched.
const TilePathPrefix = "/v1/activities/map/tiles/"

// IsTileRequest reports whether r targets the MVT tile route. Wired into the
// global rate limiter's Skip hook (cmd/apigateway) so bursty tile requests don't
// trip the JSON limiter's small burst bucket.
func IsTileRequest(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, TilePathPrefix)
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
// hugeParam: PublicRoutes/AuthenticatedRoutes are passed by value intentionally —
// NewRouter runs once at the composition root (startup), never on a hot path, so
// copying a handful of func pointers is fine.
//
//nolint:gocritic // hugeParam: AuthenticatedRoutes passed by value intentionally (startup-only) — see note above.
func NewRouter(cfg RouterConfig, public PublicRoutes, auth AuthenticatedRoutes, logger *slog.Logger) chi.Router {
	r := chi.NewRouter()

	// MIDDLEWARE ORDER CONTRACT. chi runs Use-registered middleware
	// outermost-first, so anything registered *after* the limiter is skipped when
	// the limiter rejects (it writes the 429 and returns without calling next).
	// Three constraints pin this order:
	//
	//  1. CloudRunRealIP must precede the limiter — the limiter keys per-IP
	//     buckets off r.RemoteAddr and would otherwise bucket every request from
	//  2. SecurityHeaders + CORS must precede the limiter, so a global 429 carries
	//     Access-Control-Allow-Origin and a browser can actually read it (and the
	//     Retry-After the limiter computes). Registered after, the response is
	//     opaque cross-origin and surfaces as a network error instead of a 429.
	//     Neither depends on the client IP, so they sit safely between the two.
	//     This matches the tile limiter (scoped inside /v1) and the auth limiter
	//     (inside /auth), both of which already reject inside CORS coverage.
	//  3. The logger/metrics + span-stamp middleware stay *inside* the limiter, so
	//     a 429 short-circuits before them. Deliberate, and the same call the
	//     dispatcher documents at its own r.Use(rateLimiter.Middleware): folding
	//     fast rejects into http/request.duration would drag the latency
	//     distribution toward zero exactly during a flood. Rejections are observable
	//     via desirelines.io/ratelimit/rejected{reason,limiter} instead.
	//
	// Consequence of (2): CORSMiddleware short-circuits OPTIONS preflight, so
	// preflights no longer consume rate-limit tokens. Intended — a preflight does
	// no downstream work, and a rate-limited preflight fails opaquely and takes the
	// real request down with it. Same behavior the tile/auth limiters already have.
	r.Use(chiMiddleware.RequestID)
	r.Use(gcplog.BridgeRequestID)
	r.Use(gcplog.CloudRunRealIP)
	r.Use(SecurityHeaders)
	r.Use(CORSMiddleware(cfg.CORSHandler))
	if cfg.RateLimiter != nil {
		r.Use(cfg.RateLimiter.Middleware)
	}
	r.Use(gcplog.WithCloudTraceContext)
	r.Use(otel.SpanNameFromChiRoute)
	r.Use(otel.StampRequestID)
	// Stamp X-Trace-Id on every response so the frontend can correlate a
	// browser-side log/error to a Cloud Trace, even on the success path
	// (apierrors only emits trace_id in error response bodies). Exposed
	// cross-origin via CORS Access-Control-Expose-Headers in CORSMiddleware.
	r.Use(otel.TraceIDResponseHeader)
	r.Use(gcplog.HTTPRequestLoggerWithMetrics(logger, cfg.HTTPHistogram))
	r.Use(chiMiddleware.Recoverer)

	// Root-level endpoints (health checks)
	r.Get("/health", public.Health)
	if cfg.ReadinessMiddleware != nil {
		// Keep auth failures and dependency results out of intermediary/browser
		// caches. NoCacheHeaders must wrap the OIDC check to cover its 401s.
		r.With(NoCacheHeaders, cfg.ReadinessMiddleware.Middleware).Get("/ready", public.Ready)
	} else {
		r.Get("/ready", public.Ready)
	}

	// Auth routes get a stricter per-IP rate limiter on top of the global one.
	// This is defense-in-depth on the most expensive-per-call endpoints in the
	// API (Strava API + Firestore + Firebase custom-token mint).
	r.Route("/auth", func(r chi.Router) {
		// OAuth redirects carry state and, on completion, a custom token in the
		// URL fragment. Prevent browsers/intermediaries caching any flow response.
		r.Use(NoCacheHeaders)
		if cfg.AuthRateLimiter != nil {
			r.Use(cfg.AuthRateLimiter.Middleware)
		}
		r.Get("/strava", public.AuthInitiate)
		r.Get("/strava/start", public.AuthInitiateStart)
		r.Get("/callback", public.AuthCallback)
	})

	// Versioned API routes
	r.Route("/v1", func(r chi.Router) {
		// Public endpoints (no auth required)
		r.Get("/sports/config", public.SportConfig)

		// Authenticated route group
		r.Group(func(r chi.Router) {
			// no-store must wrap auth so 401/403/503 responses are not cacheable
			// either; chi executes Use-registered middleware outermost-first.
			r.Use(NoCacheHeaders)
			r.Use(cfg.AuthMiddleware.Middleware)

			// Multi-sport endpoints (PostgreSQL backed)
			r.Get("/activities/{year}/metadata", auth.GetMetadata)
			r.Get("/activities/{year}/metrics", auth.GetMetrics)
			r.Get("/activities/{year}/source", auth.GetSource)

			// Map subsystem: per-region viewport summary + MVT vector tiles.
			r.Get("/activities/map/regions", auth.GetMapRegions)
			// TileJSON metadata (zoom levels + LOD switch) — static, so it skips the
			// tile-specific rate limiter below and uses the shared auth-group chain.
			r.Get("/activities/map/tiles.json", auth.GetMapTileJSON)
			// The tile route gets its OWN limiter (bursty profile) scoped here,
			// INSIDE the /v1 group — so it runs after the root CORSMiddleware and a
			// tile 429 carries CORS headers (surfaces truthfully), with no reorder
			// of the shared chain. The global limiter skips this path (IsTileRequest).
			if cfg.TileRateLimiter != nil {
				r.With(cfg.TileRateLimiter.Middleware).
					Get("/activities/map/tiles/{z}/{x}/{y}", auth.GetMapTile)
			} else {
				r.Get("/activities/map/tiles/{z}/{x}/{y}", auth.GetMapTile)
			}
			// Full geo-bearing dataset (scalars + region tags + optional bbox)
			// for the client-side cross-filter model. Single response, no pagination.
			r.Get("/activities/map/dataset", auth.GetMapDataset)

			// Monthly (month × sport × geographic) aggregate for the charts view.
			// Static segment, so chi matches it ahead of the {id} wildcard below.
			r.Get("/activities/summary", auth.GetActivitySummary)

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
