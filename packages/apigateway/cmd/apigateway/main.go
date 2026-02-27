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
	"syscall"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	firestoreadapter "github.com/andy-esch/desirelines/packages/apigateway/adapters/firestore"
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

	// Initialize all dependencies
	deps, err := initDependencies(ctx, cfg, log)
	if err != nil {
		return fmt.Errorf("failed to initialize dependencies: %w", err)
	}
	defer deps.Close()

	// Build router with all routes
	router := buildRouter(deps)

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
func initDependencies(ctx context.Context, cfg *config.Config, log *slog.Logger) (*Dependencies, error) {
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

	// 2. Initialize CORS handler
	deps.corsHandler = cors.NewHandler(cfg.AllowedOrigins, log)

	// 3. Initialize Firebase app (shared between auth middleware and OAuth handler)
	firebaseApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.GCPProjectID})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := firebaseApp.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}
	log.Info("Firebase app initialized", "project_id", cfg.GCPProjectID)

	// 4. Initialize auth middleware (Firebase JWT verification)
	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, log)

	// 5. Initialize Firestore client (for OAuth auth store)
	// Uses the named database (e.g., "desirelines-user-configs") rather than the
	// default "(default)" database. The database name is set via FIRESTORE_DATABASE
	// env var, configured in Terraform from google_firestore_database.user_configs.
	firestoreClient, err := firestore.NewClientWithDatabase(ctx, cfg.GCPProjectID, cfg.FirestoreDatabase)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firestore client: %w", err)
	}
	deps.firestoreClient = firestoreClient
	log.Info("Firestore client initialized", "database", cfg.FirestoreDatabase)

	// 6. Initialize OAuth auth handler
	authHandler, err := initAuthHandler(cfg, authClient, firestoreClient, log)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth handler: %w", err)
	}
	deps.authHandler = authHandler

	// 7. Initialize rate limiter (10 req/s, burst 20 — generous for normal browsing)
	deps.rateLimiter = ratelimit.New(ctx, ratelimit.Config{
		Rate:  10,
		Burst: 20,
	}, log)

	// 8. Initialize PostgreSQL repository (required dependency)
	connString, err := getConnectionString(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection string: %w", err)
	}

	pool, poolErr := postgres.NewPool(ctx, connString, log)
	if poolErr != nil {
		return nil, fmt.Errorf("failed to initialize database pool: %w", poolErr)
	}
	deps.repo = postgres.NewActivityRepository(pool)
	log.Info("Database repository initialized")

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
	}

	publicRoutes := server.PublicRoutes{
		Health:       healthHandler.Handle,
		SportConfig:  sportsHandler.HandleConfig,
		AuthInitiate: deps.authHandler.HandleInitiate,
		AuthCallback: deps.authHandler.HandleCallback,
	}

	authRoutes := server.AuthenticatedRoutes{
		GetMetadata:     activitiesHandler.HandleMetadata,
		GetMetrics:      activitiesHandler.HandleMetrics,
		GetSource:       activitiesHandler.HandleSource,
		ListActivities:  activitiesHandler.HandleListActivities,
		GetActivityByID: activitiesHandler.HandleGetActivity,
	}

	return server.NewRouter(routerCfg, publicRoutes, authRoutes, deps.logger)
}

// initAuthHandler creates the OAuth auth handler with all its dependencies.
func initAuthHandler(cfg *config.Config, authClient auth.FirebaseAuthClient, firestoreClient *firestore.Client, log *slog.Logger) (*auth.Handler, error) {
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

	stravaOAuth := stravaadapter.NewOAuthClient(stravaClientID, stravaClientSecret, log, nil)
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
		Logger:      log,
	})
	if err != nil {
		return nil, fmt.Errorf("create auth handler: %w", err)
	}

	log.Info("OAuth auth handler initialized")
	return handler, nil
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
