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
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
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
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/andy-esch/desirelines/packages/shared/secrets"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
)

func main() {
	// Logger configured for GCP Cloud Logging. See packages/shared/gcplog/README.md
	log := gcplog.NewWithLevel(config.ParseLogLevel())
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

	ctx := context.Background()

	// Initialize OTel metrics + tracing (warn and continue with no-ops on failure)
	providers, otelShutdown, otelErr := otel.Setup(ctx, log, "desirelines-api-gateway")
	if otelErr != nil {
		log.Warn("OTel disabled, using no-op providers", "error", otelErr)
		providers = otel.NoopProviders()
	} else {
		defer func() {
			if shutdownErr := otelShutdown(context.Background()); shutdownErr != nil {
				log.Error("OTel shutdown error", "error", shutdownErr)
			}
		}()
	}

	// Initialize all dependencies
	deps, err := initDependencies(ctx, cfg, log, providers.Meter)
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
	// Skip /api/health: Cloud Run polls it constantly and the spans add noise
	// and export cost without diagnostic value. Path matches the public URL
	// because otelhttp sits outside StripPrefix.
	router := otelhttp.NewHandler(
		http.StripPrefix("/api", buildRouter(deps)),
		"apigateway",
		otelhttp.WithFilter(func(r *http.Request) bool {
			return r.URL.Path != "/api/health"
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
	repo            repository.ActivityRepository
	authMiddleware  server.AuthMiddleware
	corsHandler     *cors.Handler
	sportConfig     *config.SportConfig
	rateLimiter     *ratelimit.Limiter
	firestoreClient *firestore.Client
	authHandler     *auth.Handler
	logger          *slog.Logger
	httpHistogram   otelmetric.Float64Histogram
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

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
//
//nolint:gocyclo // Composition root — wiring complexity is inherent.
func initDependencies(ctx context.Context, cfg *config.Config, log *slog.Logger, meter otelmetric.Meter) (*Dependencies, error) {
	deps := &Dependencies{
		logger: log,
	}

	// 1. Load sport configuration (embedded in binary via go:embed)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		return nil, fmt.Errorf("failed to load sport config: %w", err)
	}
	log.Info("Loaded sport config", "sport_count", len(sportConfig.ListSports()))
	deps.sportConfig = sportConfig

	// 2. Create OTel instruments (errors are non-fatal; instruments will be no-op on failure)
	postgresHist, err := meter.Float64Histogram("desirelines.io/postgres/query.duration",
		otelmetric.WithUnit("ms"), otelmetric.WithDescription("PostgreSQL query duration"))
	if err != nil {
		log.Warn("Failed to create postgres histogram", "error", err)
	}
	authHist, err := meter.Float64Histogram("desirelines.io/auth/firebase_verify.duration",
		otelmetric.WithUnit("ms"), otelmetric.WithDescription("Firebase token verification duration"))
	if err != nil {
		log.Warn("Failed to create auth histogram", "error", err)
	}
	oauthHist, err := meter.Float64Histogram("desirelines.io/strava/oauth_exchange.duration",
		otelmetric.WithUnit("ms"), otelmetric.WithDescription("Strava OAuth exchange duration"))
	if err != nil {
		log.Warn("Failed to create oauth histogram", "error", err)
	}
	httpHist, err := meter.Float64Histogram("desirelines.io/http/request.duration",
		otelmetric.WithUnit("ms"), otelmetric.WithDescription("HTTP request duration"))
	if err != nil {
		log.Warn("Failed to create http histogram", "error", err)
	}
	deps.httpHistogram = httpHist

	// 3. Initialize CORS handler
	deps.corsHandler = cors.NewHandler(cfg.AllowedOrigins, log)

	// 4–7. Auth setup: Firebase (via emulator in local dev) + Strava (mock in local dev)
	if cfg.Environment == "" && os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" {
		// Local dev: real Firebase auth (via emulator) + mock Strava
		if authErr := initLocalDevAuth(ctx, cfg, deps, log, authHist); authErr != nil {
			return nil, authErr
		}
	} else if cfg.Environment != "" {
		// Production/staging: real Firebase + real Strava
		if authErr := initFirebaseAuth(ctx, cfg, deps, log, authHist, oauthHist); authErr != nil {
			return nil, authErr
		}
	} else {
		log.Warn("No auth configured — set FIREBASE_AUTH_EMULATOR_HOST for local dev")
	}

	// 8. Initialize rate limiter (10 req/s, burst 20 — generous for normal browsing)
	deps.rateLimiter = ratelimit.New(ctx, ratelimit.Config{
		Rate:  10,
		Burst: 20,
	}, log)

	// 9. Initialize PostgreSQL repository (required dependency)
	connString, err := getConnectionString(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection string: %w", err)
	}

	pool, poolErr := postgres.NewPool(ctx, connString, log)
	if poolErr != nil {
		return nil, fmt.Errorf("failed to initialize database pool: %w", poolErr)
	}
	deps.repo = postgres.NewActivityRepository(pool, postgresHist)
	log.Info("Database repository initialized")

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
	healthHandler := health.NewHandler(deps.repo, deps.logger)
	sportsHandler := sports.NewHandler(deps.logger, deps.sportConfig)
	activitiesHandler := activities.NewHandler(deps.repo, deps.sportConfig, deps.logger)

	// Configure and create router
	routerCfg := server.RouterConfig{
		CORSHandler:    deps.corsHandler,
		AuthMiddleware: deps.authMiddleware,
		RateLimiter:    deps.rateLimiter,
		HTTPHistogram:  deps.httpHistogram,
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
		Health:       healthHandler.Handle,
		SportConfig:  sportsHandler.HandleConfig,
		AuthInitiate: authInitiate,
		AuthCallback: authCallback,
	}

	authRoutes := server.AuthenticatedRoutes{
		GetMetadata:     activitiesHandler.HandleMetadata,
		GetMetrics:      activitiesHandler.HandleMetrics,
		GetSource:       activitiesHandler.HandleSource,
		GetRoutes:       activitiesHandler.HandleRoutes,
		ListActivities:  activitiesHandler.HandleListActivities,
		GetActivityByID: activitiesHandler.HandleGetActivity,
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

	handler, err := auth.NewHandler(&auth.HandlerConfig{
		Strava:      stravaOAuth,
		Tokens:      authStore,
		Allowlist:   authStore,
		Firebase:    authClient,
		StateSecret: []byte(stateSecret),
		FrontendURL: cfg.FrontendURL,
		ClientID:    stravaClientID,
		RedirectURI: cfg.AuthCallbackURL,
		Environment: cfg.Environment,
		Logger:      log,
	})
	if err != nil {
		return nil, fmt.Errorf("create auth handler: %w", err)
	}

	log.Info("OAuth auth handler initialized")
	return handler, nil
}

// initFirebaseAuth initializes Firebase, Firestore, and OAuth dependencies.
// Extracted from initDependencies for cyclomatic complexity.
func initFirebaseAuth(ctx context.Context, cfg *config.Config, deps *Dependencies, log *slog.Logger, authHist, oauthHist otelmetric.Float64Histogram) error {
	firebaseApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.GCPProjectID})
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := firebaseApp.Auth(ctx)
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}
	log.Info("Firebase app initialized", "project_id", cfg.GCPProjectID)

	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, log, authHist)

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
func initLocalDevAuth(ctx context.Context, cfg *config.Config, deps *Dependencies, log *slog.Logger, authHist otelmetric.Float64Histogram) error {
	log.Info("Local dev auth: Firebase emulator + mock Strava")

	// Firebase Admin SDK auto-detects FIREBASE_AUTH_EMULATOR_HOST
	firebaseApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.GCPProjectID})
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := firebaseApp.Auth(ctx)
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}
	log.Info("Firebase Auth emulator connected", "host", os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"))

	// Real auth middleware — verifies JWTs against the emulator
	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, log, authHist)

	stateSecret := os.Getenv("AUTH_STATE_SECRET")
	if stateSecret == "" {
		return fmt.Errorf("AUTH_STATE_SECRET is required — generate one with: openssl rand -base64 32")
	}

	// Mock athlete ID — configurable via MOCK_ATHLETE_ID, defaults to 123456789 (matches seed data)
	mockAthleteID := int64(123456789)
	if envID := os.Getenv("MOCK_ATHLETE_ID"); envID != "" {
		parsed, parseErr := strconv.ParseInt(envID, 10, 64)
		if parseErr != nil {
			return fmt.Errorf("invalid MOCK_ATHLETE_ID %q: %w", envID, parseErr)
		}
		mockAthleteID = parsed
	}

	// Mock Strava: redirects through the gateway's own callback URL
	mockStrava := stravaadapter.NewMockOAuthClient(
		cfg.AuthCallbackURL,
		mockAthleteID,
		"Dev",     // first name
		"Athlete", // last name
	)

	// Mock auth store: always allows, discards token writes
	mockStore := mockadapter.NewAuthStore(log)

	handler, err := auth.NewHandler(&auth.HandlerConfig{
		Strava:      mockStrava,
		Tokens:      mockStore,
		Allowlist:   mockStore,
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

// getConnectionString reads PostgreSQL connection string from secret mount.
// In local development (no ENVIRONMENT set), falls back to POSTGRES_CONNECTION_STRING env var.
func getConnectionString(cfg *config.Config) (string, error) {
	// Only allow env var fallback in local development (ENVIRONMENT is always set in Cloud Run)
	envFallback := ""
	if cfg.Environment == "" {
		envFallback = "POSTGRES_CONNECTION_STRING"
	}

	return secrets.LoadFromMount(config.SecretPathPostgresConn, envFallback)
}
