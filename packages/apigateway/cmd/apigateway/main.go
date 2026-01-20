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

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/activities"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/health"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/sports"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

// Server timeout defaults (can be overridden via environment variables).
const (
	defaultReadTimeout       = 30 * time.Second
	defaultWriteTimeout      = 30 * time.Second
	defaultReadHeaderTimeout = 10 * time.Second
	defaultShutdownTimeout   = 30 * time.Second
)

func main() {
	log := logger.New()
	log.Info("Starting API Gateway")

	ctx := context.Background()

	// Initialize all dependencies
	deps, err := initDependencies(ctx, log)
	if err != nil {
		log.Error("Failed to initialize dependencies", "error", err)
		os.Exit(1)
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

	// Start server in goroutine to allow graceful shutdown
	go func() {
		log.Info("Server listening", "port", port)
		if serverErr := srv.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
			log.Error("Server failed", "error", serverErr)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server...")

	// Give server time to finish in-flight requests
	shutdownTimeout := getDurationEnv("SERVER_SHUTDOWN_TIMEOUT", defaultShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if shutdownErr := srv.Shutdown(shutdownCtx); shutdownErr != nil {
		log.Error("Server forced to shutdown", "error", shutdownErr)
		os.Exit(1)
	}

	log.Info("Server exited gracefully")
}

// Dependencies holds all initialized dependencies for the application.
type Dependencies struct {
	repo           repository.ActivityRepository
	authMiddleware server.AuthMiddleware
	corsHandler    *cors.Handler
	sportConfig    *config.SportConfig
	logger         *slog.Logger
}

// Close releases all dependency resources.
func (d *Dependencies) Close() {
	if d.repo != nil {
		if err := d.repo.Close(); err != nil {
			d.logger.Error("Error closing repository", "error", err)
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
	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")
	var allowedOrigins []string
	if allowedOriginsEnv != "" {
		parts := strings.Split(allowedOriginsEnv, ",")
		for _, o := range parts {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	}
	deps.corsHandler = cors.NewHandler(allowedOrigins, log)

	// 3. Initialize auth middleware (Firebase JWT + email allowlist)
	allowedEmails := getAllowedEmails()
	authMiddleware, err := middleware.NewFirebaseAuth(ctx, allowedEmails, log)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth middleware: %w", err)
	}
	deps.authMiddleware = authMiddleware

	// 4. Initialize PostgreSQL repository (required dependency)
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
	sportsHandler := sports.NewHandler(deps.logger)
	activitiesHandler := activities.NewHandler(deps.repo, deps.sportConfig, deps.logger)

	// Configure and create router
	routerCfg := server.RouterConfig{
		CORSHandler:    deps.corsHandler,
		AuthMiddleware: deps.authMiddleware,
	}

	publicRoutes := server.PublicRoutes{
		Health:      healthHandler.Handle,
		SportConfig: sportsHandler.HandleConfig,
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
		if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return defaultValue
}

// getAllowedEmails reads allowed emails from environment variable.
func getAllowedEmails() []string {
	allowedEmailsEnv := os.Getenv("ALLOWED_EMAILS")
	if allowedEmailsEnv == "" {
		return nil
	}

	var emails []string
	for _, email := range strings.Split(allowedEmailsEnv, ",") {
		if trimmed := strings.TrimSpace(email); trimmed != "" {
			emails = append(emails, trimmed)
		}
	}
	return emails
}

// getConnectionString reads PostgreSQL connection string from secret mount or environment variable.
func getConnectionString() (string, error) {
	// Try secret mount first (Cloud Run)
	const secretPath = "/etc/secrets/postgres/connection_string" //nolint:gosec // G101: Not credentials, just a file path
	if data, err := os.ReadFile(secretPath); err == nil {
		return strings.TrimSpace(string(data)), nil
	}

	// Fallback to env var (local dev)
	if connStr := os.Getenv("POSTGRES_CONNECTION_STRING"); connStr != "" {
		return connStr, nil
	}

	return "", fmt.Errorf("no connection string found (checked %s and POSTGRES_CONNECTION_STRING)", secretPath)
}
