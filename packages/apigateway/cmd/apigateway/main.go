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
	"strings"
	"syscall"
	"time"

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
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/andy-esch/desirelines/packages/shared/secrets"
)

// Server timeout defaults (can be overridden via environment variables).
const (
	defaultReadTimeout       = 30 * time.Second
	defaultWriteTimeout      = 30 * time.Second
	defaultReadHeaderTimeout = 10 * time.Second
	defaultShutdownTimeout   = 30 * time.Second
)

func main() {
	// Logger configured for GCP Cloud Logging. See packages/shared/gcplog/README.md
	log := gcplog.New()
	log.Info("Starting API Gateway")

	if err := run(log); err != nil {
		log.Error("Application failed", "error", err)
		os.Exit(1)
	}
	log.Info("Server exited gracefully")
}

func run(log *slog.Logger) error {
	ctx := context.Background()

	// Initialize all dependencies
	deps, err := initDependencies(ctx, log)
	if err != nil {
		return fmt.Errorf("failed to initialize dependencies: %w", err)
	}
	defer deps.Close()

	// Build router with all routes
	router := buildRouter(deps)

	// Start server with configurable timeouts
	port := getEnvOrDefault("PORT", "8080")
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadTimeout:       getDurationEnv("SERVER_READ_TIMEOUT", defaultReadTimeout),
		WriteTimeout:      getDurationEnv("SERVER_WRITE_TIMEOUT", defaultWriteTimeout),
		ReadHeaderTimeout: getDurationEnv("SERVER_READ_HEADER_TIMEOUT", defaultReadHeaderTimeout),
	}

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	// Error channel to capture server errors
	serverErrors := make(chan error, 1)

	// Start server in goroutine to allow graceful shutdown
	go func() {
		log.Info("Server listening", "port", port)
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

	// Give server time to finish in-flight requests
	shutdownTimeout := getDurationEnv("SERVER_SHUTDOWN_TIMEOUT", defaultShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
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
func initDependencies(ctx context.Context, log *slog.Logger) (*Dependencies, error) {
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
	allowedOrigins := parseCommaSeparatedEnv("ALLOWED_ORIGINS")
	deps.corsHandler = cors.NewHandler(allowedOrigins, log)

	// 3. Initialize Firebase app (shared between auth middleware and OAuth handler)
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}
	if projectID == "" {
		return nil, fmt.Errorf("GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable must be set")
	}

	firebaseApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	authClient, err := firebaseApp.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase Auth client: %w", err)
	}
	log.Info("Firebase app initialized", "project_id", projectID)

	// 4. Initialize auth middleware (Firebase JWT + email allowlist)
	allowedEmails, err := getAllowedEmails()
	if err != nil {
		return nil, fmt.Errorf("failed to get allowed emails: %w", err)
	}
	deps.authMiddleware = middleware.NewAuthMiddleware(authClient, allowedEmails, log)

	// 5. Initialize Firestore client (for OAuth auth store)
	firestoreClient, err := firebaseApp.Firestore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firestore client: %w", err)
	}
	deps.firestoreClient = firestoreClient
	log.Info("Firestore client initialized")

	// 6. Initialize OAuth auth handler
	authHandler, err := initAuthHandler(authClient, firestoreClient, log)
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
	connString, err := getConnectionString()
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
func initAuthHandler(authClient auth.FirebaseTokenCreator, firestoreClient *firestore.Client, log *slog.Logger) (*auth.Handler, error) {
	// Load Strava OAuth credentials
	const stravaClientIDPath = "/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value"
	const stravaClientSecretPath = "/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value" //nolint:gosec // G101: Not credentials, just a file path
	const stateSecretPath = "/etc/secrets/INFISICAL_AUTH_STATE_SECRET/value"           //nolint:gosec // G101: Not credentials, just a file path

	stravaClientID, err := secrets.LoadFromMount(stravaClientIDPath, "STRAVA_CLIENT_ID")
	if err != nil {
		return nil, fmt.Errorf("strava client_id: %w", err)
	}

	stravaClientSecret, err := secrets.LoadFromMount(stravaClientSecretPath, "STRAVA_CLIENT_SECRET")
	if err != nil {
		return nil, fmt.Errorf("strava client_secret: %w", err)
	}

	stateSecret, err := secrets.LoadFromMount(stateSecretPath, "AUTH_STATE_SECRET")
	if err != nil {
		return nil, fmt.Errorf("auth state secret: %w", err)
	}

	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		return nil, fmt.Errorf("FRONTEND_URL environment variable must be set")
	}

	callbackURL := os.Getenv("AUTH_CALLBACK_URL")
	if callbackURL == "" {
		return nil, fmt.Errorf("AUTH_CALLBACK_URL environment variable must be set")
	}

	stravaOAuth := stravaadapter.NewOAuthClient(stravaClientID, stravaClientSecret, log, nil)
	authStore := firestoreadapter.NewAuthStore(firestoreClient, log)

	handler := auth.NewHandler(&auth.HandlerConfig{
		Strava:      stravaOAuth,
		Tokens:      authStore,
		Allowlist:   authStore,
		Firebase:    authClient,
		StateSecret: []byte(stateSecret),
		FrontendURL: frontendURL,
		ClientID:    stravaClientID,
		RedirectURI: callbackURL,
		Logger:      log,
	})

	log.Info("OAuth auth handler initialized")
	return handler, nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getDurationEnv reads a duration from environment variable (in seconds).
// Returns defaultValue if the environment variable is not set or invalid.
func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		seconds, err := strconv.Atoi(value)
		if err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
		if err != nil {
			slog.Warn("Invalid environment variable value, using default", "key", key, "value", value, "error", err)
		} else {
			slog.Warn("Invalid environment variable value (must be positive), using default", "key", key, "value", value)
		}
	}
	return defaultValue
}

// getAllowedEmails reads allowed emails from secret mount (Cloud Run) or environment variable (local dev).
func getAllowedEmails() ([]string, error) {
	const secretPath = "/etc/secrets/INFISICAL_ALLOWED_EMAILS/value" //nolint:gosec // G101: Not credentials, just a file path
	value, err := secrets.LoadFromMount(secretPath, "ALLOWED_EMAILS")
	if err != nil {
		return nil, err
	}
	return parseCommaSeparated(value), nil
}

// parseCommaSeparatedEnv reads an environment variable and parses it as a
// comma-separated list, trimming whitespace and filtering empty values.
func parseCommaSeparatedEnv(key string) []string {
	value := os.Getenv(key)
	if value == "" {
		return nil
	}
	return parseCommaSeparated(value)
}

// parseCommaSeparated splits a comma-separated string, trimming whitespace and filtering empty values.
func parseCommaSeparated(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

// getConnectionString reads PostgreSQL connection string from secret mount.
// In local development (no ENVIRONMENT set), falls back to POSTGRES_CONNECTION_STRING env var.
func getConnectionString() (string, error) {
	const secretPath = "/etc/secrets/INFISICAL_POSTGRES_CONN_APIGATEWAY/value" //nolint:gosec // G101: Not credentials, just a file path

	// Only allow env var fallback in local development (ENVIRONMENT is always set in Cloud Run)
	envFallback := ""
	if os.Getenv("ENVIRONMENT") == "" {
		envFallback = "POSTGRES_CONNECTION_STRING"
	}

	return secrets.LoadFromMount(secretPath, envFallback)
}
