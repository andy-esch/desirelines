// Package main provides the HTTP server entrypoint for the API Gateway.
// Designed for Cloud Run deployment with graceful shutdown support.
//
// This file serves as the composition root - it wires together all dependencies
// following hexagonal architecture principles. Dependencies flow inward:
//
//	main.go → handlers → repository interface → adapters/postgres
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
	firestoreadapter "github.com/andy-esch/desirelines/packages/apigateway/adapters/firestore"
	mockadapter "github.com/andy-esch/desirelines/packages/apigateway/adapters/mock"
	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	stravaadapter "github.com/andy-esch/desirelines/packages/apigateway/adapters/strava"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/activities"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/health"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/sports"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/synthetic"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/shared/allowlist"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/andy-esch/desirelines/packages/shared/secrets"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	// Logger configured for GCP Cloud Logging. See packages/shared/gcplog/README.md
	log := gcplog.NewWithLevel(config.ParseLogLevel())
	// Mirror onto the slog default so library code (e.g.,
	// config.SportConfig.GetCategoryForStravaType, which emits the
	// "Unknown Strava sport_type detected" WARNING the log-based metric
	// alerts on) writes through the same GCP-formatted JSON handler.
	slog.SetDefault(log)
	log.Info("Starting API Gateway")

	if err := run(log); err != nil {
		log.Error("Application failed", "error", err)
		os.Exit(1)
	}
	log.Info("Server exited gracefully")
}

func run(log *slog.Logger) error {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Boot-time configuration log. Operational fields only — secrets are
	// loaded out-of-band via secrets.LoadFromMount and intentionally never
	// touch this struct.
	log.Info("apigateway boot config", cfg.LogAttrs()...)

	ctx := context.Background()

	// Initialize OTel metrics + tracing (warn and continue with no-ops on failure)
	providers, otelShutdown, otelErr := otel.Setup(ctx, log, "desirelines-api-gateway")
	if otelErr != nil {
		log.Warn("OTel disabled, using no-op providers", "error", otelErr)
		providers = otel.NoopProviders()
	} else {
		defer func() {
			// Bound the flush: otelShutdown joins the span/metric exporter
			// flushes, which block on Cloud Trace/Monitoring. Without a deadline
			// a slow/unreachable backend during deploy blocks until Cloud Run
			// SIGKILLs the container — and this error log never runs. Use the
			// same budget as the HTTP server shutdown below.
			shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
			defer cancel()
			if shutdownErr := otelShutdown(shutdownCtx); shutdownErr != nil {
				log.Error("OTel shutdown error", "error", shutdownErr)
			}
		}()
	}

	// Initialize all dependencies
	deps, err := initDependencies(ctx, cfg, log, providers.Meter, providers.Tracer)
	if err != nil {
		return fmt.Errorf("failed to initialize dependencies: %w", err)
	}
	defer deps.Close()

	// Build router with all routes. Wrap with StripPrefix so requests proxied
	// through Firebase Hosting at /api/... have the prefix removed before
	// reaching the chi router. All traffic arrives via /api/... (both dev and
	// prod route through Firebase Hosting rewrites).
	//
	// Wrap the whole stack with otelhttp so Cloud Trace gets a server span per
	// request and the gcplog middleware adopts its trace_id for log correlation.
	// Span names are refined to "METHOD /route/pattern" by SpanNameFromChiRoute
	// middleware inside the chi stack (see server/router.go).
	//
	// Skip /api/health and /api/ready: Cloud Run probes /api/health on every
	// container, the GCP uptime check fans it out from multiple regions, and
	// Cloud Scheduler hits /api/ready hourly. None of these need traces, and
	// the spans add noise and export cost without diagnostic value. Path
	// matches the public URL because otelhttp sits outside StripPrefix.
	//
	// WithPublicEndpointFn: apigateway is internet-facing via Firebase
	// Hosting, so callers can inject arbitrary traceparent /
	// X-Cloud-Trace-Context headers. Without this option otelhttp would
	// *continue* that trace, letting a user pollute our trace tree or
	// collide their request with a real internal trace_id. This option
	// creates a fresh root span per request and *links* the caller's span
	// context, preserving the correlation handle without trusting the ID
	// for our tree. Returning true unconditionally is correct here because
	// every path served by this handler is reached from the public
	// internet via Firebase Hosting. (otelhttp deprecated the no-arg
	// WithPublicEndpoint in favor of this function variant.) Dispatcher
	// does NOT need this — it's authenticated by Cloud Run IAM and receives
	// only trusted internal callers (PubSub push, Cloud Scheduler).
	router := otelhttp.NewHandler(
		http.StripPrefix("/api", buildRouter(deps)),
		"apigateway",
		otelhttp.WithPublicEndpointFn(func(_ *http.Request) bool { return true }),
		otelhttp.WithFilter(func(r *http.Request) bool {
			p := r.URL.Path
			return p != "/api/health" && p != "/api/ready"
		}),
	)

	// Start server with configurable timeouts
	port := config.GetEnvOrDefault("PORT", "8080")
	log.Info("Server listening", "port", port)

	// Create server with configurable timeouts for security
	// #nosec G114 - Timeouts are configured via environment variables
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	// Error channel to capture server errors
	serverErrors := make(chan error, 1)
	// Signal channel for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if serverErr := srv.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
			serverErrors <- fmt.Errorf("server failed: %w", serverErr)
		}
	}()

	// Block until signal or error
	select {
	case srvErr := <-serverErrors:
		return srvErr
	case <-quit:
		log.Info("Shutting down server...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if shutdownErr := srv.Shutdown(shutdownCtx); shutdownErr != nil {
		return fmt.Errorf("server forced to shutdown: %w", shutdownErr)
	}

	return nil
}

// Dependencies holds all initialized dependencies for the application.
type Dependencies struct {
	repo             repository.ActivityRepository
	authMiddleware   server.AuthMiddleware
	corsHandler      *cors.Handler
	sportConfig      *config.SportConfig
	rateLimiter      *ratelimit.Limiter
	authRateLimiter  *ratelimit.Limiter
	firestoreClient  *firestore.Client
	authHandler      *auth.Handler
	logger           *slog.Logger
	httpHistogram    otelmetric.Float64Histogram
	readinessTimeout time.Duration

	// enableSyntheticFaults gates the SLO-rehearsal endpoints in
	// `internal/synthetic`. True for any non-production environment.
	// See internal/synthetic/handler.go for context + removal steps.
	enableSyntheticFaults bool
}

// Close releases all dependency resources.
func (d *Dependencies) Close() {
	if d.repo != nil {
		if err := d.repo.Close(); err != nil {
			d.logger.Error("Error closing repository", "error", err)
		}
	}
	if d.firestoreClient != nil {
		if err := d.firestoreClient.Close(); err != nil {
			d.logger.Error("Error closing Firestore client", "error", err)
		}
	}
}

// newDurationHistogram creates a "ms"-unit duration histogram. Errors are
// non-fatal: the OTel API returns a usable (no-op-on-failure) instrument plus an
// error, so we log a warning and return the instrument. Centralizing the
// WithUnit("ms") invariant that terraform/.../alerts.tf relies on keeps it in
// one place instead of copy-pasted per instrument.
func newDurationHistogram(meter otelmetric.Meter, log *slog.Logger, name, desc string) otelmetric.Float64Histogram {
	h, err := meter.Float64Histogram(name, otelmetric.WithUnit("ms"), otelmetric.WithDescription(desc))
	if err != nil {
		log.Warn("Failed to create histogram", "name", name, "error", err)
	}
	return h
}

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
func initDependencies(ctx context.Context, cfg *config.Config, log *slog.Logger, meter otelmetric.Meter, tracer trace.Tracer) (*Dependencies, error) {
	deps := &Dependencies{
		logger:                log,
		readinessTimeout:      cfg.ReadinessTimeout,
		enableSyntheticFaults: !cfg.Environment.IsProduction(),
	}

	// 1. Load sport configuration (embedded in binary via go:embed)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		return nil, fmt.Errorf("failed to load sport config: %w", err)
	}
	log.Info("Loaded sport config", "sport_count", len(sportConfig.ListSports()))
	deps.sportConfig = sportConfig

	// 2. Create OTel instruments (errors are non-fatal; instruments will be no-op on failure)
	postgresHist := newDurationHistogram(meter, log, "desirelines.io/postgres/query.duration", "PostgreSQL query duration")
	// Name matches the `auth.verify_id_token` span emitted by AuthMiddleware
	// so the convention "histogram operation == span name" stays 1:1 across
	// the apigateway. Old metric `auth/firebase_verify.duration` predates the
	// span and is no longer written; query the new name going forward.
	authHist := newDurationHistogram(meter, log, "desirelines.io/auth/verify_id_token.duration", "Firebase ID token verification duration")
	oauthHist := newDurationHistogram(meter, log, "desirelines.io/strava/oauth_exchange.duration", "Strava OAuth exchange duration")
	httpHist := newDurationHistogram(meter, log, "desirelines.io/http/request.duration", "HTTP request duration")
	deps.httpHistogram = httpHist

	// 3. Initialize CORS handler. Strict in any non-local environment so a
	// missing ALLOWED_ORIGINS fails the deploy at boot rather than
	// silently rejecting every cross-origin request after rollout.
	corsHandler, err := cors.NewHandler(cfg.AllowedOrigins, log, !cfg.Environment.IsLocal())
	if err != nil {
		return nil, fmt.Errorf("init CORS: %w", err)
	}
	deps.corsHandler = corsHandler

	// 4–7. Auth setup: Firebase (via emulator in local dev) + Strava (mock in local dev)
	if cfg.Environment.IsLocal() && os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		// Local dev: real Firebase auth (via emulator) + mock Strava
		if authErr := initLocalDevAuth(ctx, cfg, deps, log, authHist, tracer); authErr != nil {
			return nil, authErr
		}
	} else if !cfg.Environment.IsLocal() {
		// Production/staging: real Firebase + real Strava
		if authErr := initFirebaseAuth(ctx, cfg, deps, log, authHist, oauthHist, tracer); authErr != nil {
			return nil, authErr
		}
	} else {
		log.Warn("No auth configured — set FIREBASE_AUTH_EMULATOR_HOST for local dev")
	}

	// 8a. Initialize global rate limiter (10 req/s, burst 20 — generous for normal browsing)
	deps.rateLimiter = ratelimit.New(ctx, ratelimit.Config{
		Rate:  10,
		Burst: 20,
	}, log)

	// 8b. Initialize auth-scoped rate limiter. /auth/* endpoints are the most
	// expensive per-call in the system (Strava API + Firestore + Firebase custom
	// token mint), and a legitimate user hits them once per session at most.
	// 10/min per IP is well above any legitimate pattern and well below probing
	// rates. Hard-coded for now since it's not security-load-bearing; revisit if
	// tuning becomes a thing.
	deps.authRateLimiter = ratelimit.New(ctx, ratelimit.Config{
		Rate:  10.0 / 60.0, // 10 per minute
		Burst: 5,           // allow a small burst for retries
	}, log)

	// 9. Initialize PostgreSQL repository (required dependency)
	connString, err := getConnectionString(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection string: %w", err)
	}

	pool, poolErr := postgres.NewPool(ctx, connString, log, tracer)
	if poolErr != nil {
		return nil, fmt.Errorf("failed to initialize database pool: %w", poolErr)
	}
	deps.repo = postgres.NewActivityRepository(pool, postgresHist, tracer)
	log.Info("Database repository initialized")

	// 9a. Local-only sanity check: warn (don't fail) if MOCK_ATHLETE_ID has
	// no rows in the seed DB. Saves a "why is the dashboard blank?" debug
	// session for new contributors. Production envs skip this entirely.
	if cfg.Environment.IsLocal() {
		checkMockAthleteSeedData(ctx, pool, log)
	}

	// 10. Register async pool gauge callback
	poolGauge, gaugeErr := meter.Int64ObservableGauge("desirelines.io/postgres/pool.connections",
		otelmetric.WithDescription("PostgreSQL connection pool state"))
	if gaugeErr != nil {
		log.Warn("Failed to create pool gauge", "error", gaugeErr)
	}
	if poolGauge != nil {
		stateAttr := attribute.Key("state")
		if _, cbErr := meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
			stat := pool.Stat()
			o.ObserveInt64(poolGauge, int64(stat.IdleConns()), otelmetric.WithAttributes(stateAttr.String("idle")))
			o.ObserveInt64(poolGauge, int64(stat.AcquiredConns()), otelmetric.WithAttributes(stateAttr.String("in_use")))
			o.ObserveInt64(poolGauge, int64(stat.TotalConns()), otelmetric.WithAttributes(stateAttr.String("total")))
			return nil
		}, poolGauge); cbErr != nil {
			log.Warn("Failed to register pool gauge callback", "error", cbErr)
		}
	}

	return deps, nil
}

// buildRouter creates the HTTP router with all handlers wired up.
func buildRouter(deps *Dependencies) http.Handler {
	// Create feature handlers with their dependencies
	healthHandler := health.NewHandlerWithTimeout(deps.repo, deps.logger, deps.readinessTimeout)
	sportsHandler := sports.NewHandler(deps.logger, deps.sportConfig)
	activitiesHandler := activities.NewHandler(deps.repo, deps.sportConfig, deps.logger)

	// Synthetic-fault handler for SLO + security-alert rehearsal.
	// Registered only when deps.enableSyntheticFaults is true (non-
	// production envs). To remove cleanly, delete this assignment +
	// the SyntheticFault field on AuthenticatedRoutes below + the
	// `internal/synthetic` package itself.
	syntheticHandler := synthetic.NewHandler(deps.logger)

	// Configure and create router
	routerCfg := server.RouterConfig{
		CORSHandler:           deps.corsHandler,
		AuthMiddleware:        deps.authMiddleware,
		RateLimiter:           deps.rateLimiter,
		AuthRateLimiter:       deps.authRateLimiter,
		HTTPHistogram:         deps.httpHistogram,
		EnableSyntheticFaults: deps.enableSyntheticFaults,
	}

	// Auth routes — authHandler may be nil if no auth is configured (no emulator, no env)
	var authInitiate, authCallback http.HandlerFunc
	if deps.authHandler != nil {
		authInitiate = deps.authHandler.HandleInitiate
		authCallback = deps.authHandler.HandleCallback
	} else {
		noAuth := func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "OAuth not configured — set FIREBASE_AUTH_EMULATOR_HOST for local dev", http.StatusNotImplemented)
		}
		authInitiate = noAuth
		authCallback = noAuth
	}

	publicRoutes := server.PublicRoutes{
		Health:       healthHandler.HandleLive,
		Ready:        healthHandler.HandleReady,
		SportConfig:  sportsHandler.HandleConfig,
		AuthInitiate: authInitiate,
		AuthCallback: authCallback,
	}

	authRoutes := server.AuthenticatedRoutes{
		GetMetadata:     activitiesHandler.HandleMetadata,
		GetMetrics:      activitiesHandler.HandleMetrics,
		GetSource:       activitiesHandler.HandleSource,
		GetRoutes:       activitiesHandler.HandleRoutes,
		GetRouteTile:    activitiesHandler.HandleRouteTile,
		GetRouteRegions: activitiesHandler.HandleRouteRegions,
		ListActivities:  activitiesHandler.HandleListActivities,
		GetActivityByID: activitiesHandler.HandleGetActivity,
		SyntheticFault:  syntheticHandler.Fault,
	}

	return server.NewRouter(routerCfg, publicRoutes, authRoutes, deps.logger)
}

// initAuthHandler creates the OAuth auth handler with all its dependencies.
func initAuthHandler(cfg *config.Config, authClient auth.FirebaseAuthClient, firestoreClient *firestore.Client, log *slog.Logger, oauthHist otelmetric.Float64Histogram) (*auth.Handler, error) {
	// Load Strava OAuth credentials from Infisical mounts
	stravaClientID, err := secrets.LoadFromMount(config.SecretPathStravaClientID, "STRAVA_CLIENT_ID")
	if err != nil {
		return nil, fmt.Errorf("strava client_id: %w", err)
	}

	stravaClientSecret, err := secrets.LoadFromMount(config.SecretPathStravaClientSecret, "STRAVA_CLIENT_SECRET")
	if err != nil {
		return nil, fmt.Errorf("strava client_secret: %w", err)
	}

	stateSecret, err := secrets.LoadFromMount(config.SecretPathAuthStateSecret, "AUTH_STATE_SECRET")
	if err != nil {
		return nil, fmt.Errorf("auth state secret: %w", err)
	}

	stravaOAuth := stravaadapter.NewOAuthClient(stravaClientID, stravaClientSecret, log, nil, oauthHist)
	authStore := firestoreadapter.NewAuthStore(firestoreClient, log)
	allowChecker := allowlist.NewFirestoreChecker(firestoreClient, log)

	handler, err := auth.NewHandler(&auth.HandlerConfig{
		Strava:       stravaOAuth,
		Tokens:       authStore,
		Allowlist:    allowChecker,
		Firebase:     authClient,
		StateSecret:  []byte(stateSecret),
		FrontendURL:  cfg.FrontendURL,
		ClientID:     stravaClientID,
		RedirectURI:  cfg.AuthCallbackURL,
		RequireHTTPS: !cfg.Environment.IsLocal(),
		Logger:       log,
	})
	if err != nil {
		return nil, fmt.Errorf("create auth handler: %w", err)
	}

	log.Info("OAuth auth handler initialized")
	return handler, nil
}

// newFirebaseAuthClient initializes a Firebase app and returns its Auth client.
// Shared by the production and local-dev auth setups; each caller keeps its own
// success log line (prod logs project_id, local logs the emulator host).
func newFirebaseAuthClient(ctx context.Context, projectID string) (*firebaseauth.Client, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}
	return client, nil
}

// initFirebaseAuth initializes Firebase, Firestore, and OAuth dependencies.
// Extracted from initDependencies for cyclomatic complexity.
func initFirebaseAuth(ctx context.Context, cfg *config.Config, deps *Dependencies, log *slog.Logger, authHist, oauthHist otelmetric.Float64Histogram, tracer trace.Tracer) error {
	authClient, err := newFirebaseAuthClient(ctx, cfg.GCPProjectID)
	if err != nil {
		return err
	}
	log.Info("Firebase app initialized", "project_id", cfg.GCPProjectID)

	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, log, authHist, tracer)

	firestoreClient, err := firestore.NewClientWithDatabase(ctx, cfg.GCPProjectID, cfg.FirestoreDatabase)
	if err != nil {
		return fmt.Errorf("failed to initialize Firestore client: %w", err)
	}
	deps.firestoreClient = firestoreClient
	log.Info("Firestore client initialized", "database", cfg.FirestoreDatabase)

	authHandler, err := initAuthHandler(cfg, authClient, firestoreClient, log, oauthHist)
	if err != nil {
		return fmt.Errorf("failed to initialize auth handler: %w", err)
	}
	deps.authHandler = authHandler

	return nil
}

// initLocalDevAuth sets up auth for local development using the Firebase Auth
// emulator (for real JWT minting/verification) and a mock Strava adapter (to
// skip the real Strava OAuth redirect). The full auth middleware runs on every
// request, exactly as in production.
// defaultMockAthleteID is the seed athlete used in local dev; matches the
// seed-data script (just db-migrate-local).
const defaultMockAthleteID int64 = 123456789

// resolveMockAthleteID returns the configured mock athlete ID, defaulting to
// defaultMockAthleteID when MOCK_ATHLETE_ID is unset. Callers keep their own
// error policy (fail-boot vs. warn-and-skip).
func resolveMockAthleteID() (int64, error) {
	envID := os.Getenv("MOCK_ATHLETE_ID")
	if envID == "" {
		return defaultMockAthleteID, nil
	}
	id, err := strconv.ParseInt(envID, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %q: %w", envID, err)
	}
	return id, nil
}

// randomSecret returns a base64-encoded, cryptographically-random secret of n
// bytes. Used to mint an ephemeral OAuth state-signing secret for local dev when
// AUTH_STATE_SECRET is unset.
func randomSecret(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func initLocalDevAuth(ctx context.Context, cfg *config.Config, deps *Dependencies, log *slog.Logger, authHist otelmetric.Float64Histogram, tracer trace.Tracer) error {
	log.Info("Local dev auth: Firebase emulator + mock Strava")

	// Firebase Admin SDK auto-detects FIREBASE_AUTH_EMULATOR_HOST
	authClient, err := newFirebaseAuthClient(ctx, cfg.GCPProjectID)
	if err != nil {
		return err
	}
	log.Info("Firebase Auth emulator connected", "host", os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"))

	// Real auth middleware — verifies JWTs against the emulator
	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, log, authHist, tracer)

	// Local dev signs the OAuth state JWT within this single process for one mock
	// round-trip, so a provisioned secret isn't required here — fall back to an
	// ephemeral random one (with a warning) rather than failing the boot. Prod and
	// dev read the mounted INFISICAL_AUTH_STATE_SECRET via the non-local code path.
	stateSecret := os.Getenv("AUTH_STATE_SECRET")
	if stateSecret == "" {
		ephemeral, err := randomSecret(32)
		if err != nil {
			return fmt.Errorf("generate ephemeral AUTH_STATE_SECRET: %w", err)
		}
		stateSecret = ephemeral
		log.Warn("AUTH_STATE_SECRET not set; using an ephemeral per-process secret for local dev " +
			"(in-flight OAuth state won't survive a gateway restart). Set AUTH_STATE_SECRET to silence.")
	}

	// Mock athlete ID — configurable via MOCK_ATHLETE_ID, defaults to
	// defaultMockAthleteID (matches seed data).
	mockAthleteID, err := resolveMockAthleteID()
	if err != nil {
		return fmt.Errorf("invalid MOCK_ATHLETE_ID: %w", err)
	}

	// Mock Strava: redirects through the gateway's own callback URL
	mockStrava := stravaadapter.NewMockOAuthClient(
		cfg.AuthCallbackURL,
		mockAthleteID,
		"Dev",     // first name
		"Athlete", // last name
	)

	// Mock auth store + allowlist checker: always allows, discards token writes
	mockStore := mockadapter.NewAuthStore(log)
	mockAllowlist := mockadapter.NewAllowlistChecker(log)

	handler, err := auth.NewHandler(&auth.HandlerConfig{
		Strava:      mockStrava,
		Tokens:      mockStore,
		Allowlist:   mockAllowlist,
		Firebase:    authClient,
		StateSecret: []byte(stateSecret),
		FrontendURL: cfg.FrontendURL,
		ClientID:    "mock-client-id",
		RedirectURI: cfg.AuthCallbackURL,
		Logger:      log,
	})
	if err != nil {
		return fmt.Errorf("create local dev auth handler: %w", err)
	}
	deps.authHandler = handler

	log.Info("Local dev auth initialized (mock Strava + Firebase emulator)")
	return nil
}

// checkMockAthleteSeedData warns (without failing boot) when MOCK_ATHLETE_ID
// has zero activities in the local database. The check is local-dev-only —
// callers must gate it on cfg.Environment.IsLocal().
//
// A failed query is logged at WARN (the DB might not be reachable yet) but
// boot continues. A zero-row result hints at the seed-data script. Both
// outcomes are recoverable: legitimate use of an empty DB (fresh-DB testing)
// is supported, so this never returns an error.
func checkMockAthleteSeedData(ctx context.Context, pool *postgres.Pool, log *slog.Logger) {
	mockAthleteID, err := resolveMockAthleteID()
	if err != nil {
		log.Warn("MOCK_ATHLETE_ID sanity check skipped",
			"error", err,
			"hint", "MOCK_ATHLETE_ID must be a base-10 integer")
		return
	}

	userID := strconv.FormatInt(mockAthleteID, 10)
	var count int
	err = pool.QueryRow(ctx,
		"SELECT count(*) FROM desirelines.activities WHERE user_id = $1",
		userID,
	).Scan(&count)
	switch {
	case err != nil:
		log.Warn("MOCK_ATHLETE_ID sanity check failed",
			"error", err,
			"mock_athlete_id", mockAthleteID,
			"hint", "DB may not be reachable yet")
	case count == 0:
		log.Warn("MOCK_ATHLETE_ID has no activities in DB",
			"mock_athlete_id", mockAthleteID,
			"hint", "run `just db-migrate-local` to apply seed data, or set MOCK_ATHLETE_ID to match an existing user_id")
	default:
		log.Debug("MOCK_ATHLETE_ID has activities in DB",
			"mock_athlete_id", mockAthleteID,
			"count", count)
	}
}

// getConnectionString reads PostgreSQL connection string from secret mount.
// In local development, falls back to POSTGRES_CONNECTION_STRING env var.
func getConnectionString(cfg *config.Config) (string, error) {
	// Only allow env var fallback in local development. Cloud Run always sets
	// ENVIRONMENT to "dev" or "prod", so this branch is taken only locally.
	envFallback := ""
	if cfg.Environment.IsLocal() {
		envFallback = "POSTGRES_CONNECTION_STRING"
	}

	conn, err := secrets.LoadFromMount(config.SecretPathPostgresConn, envFallback)
	if err != nil {
		return "", fmt.Errorf("load postgres connection string: %w", err)
	}
	return conn, nil
}
