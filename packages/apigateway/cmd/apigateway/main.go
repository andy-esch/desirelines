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
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/activities"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/health"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/sports"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

func main() {
	logger.Logger.Info("Starting API Gateway")

	ctx := context.Background()

	// Initialize all dependencies
	deps, err := initDependencies(ctx)
	if err != nil {
		logger.Logger.Error("Failed to initialize dependencies", "error", err)
		os.Exit(1)
	}
	defer deps.Close()

	// Build router with all routes
	router := buildRouter(deps)

	// Start server
	port := getEnvOrDefault("PORT", "8080")
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Start server in goroutine to allow graceful shutdown
	go func() {
		logger.Logger.Info("Server listening", "port", port)
		if serverErr := srv.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
			logger.Logger.Error("Server failed", "error", serverErr)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Logger.Info("Shutting down server...")

	// Give server 30 seconds to finish in-flight requests
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if shutdownErr := srv.Shutdown(shutdownCtx); shutdownErr != nil {
		logger.Logger.Error("Server forced to shutdown", "error", shutdownErr)
		os.Exit(1)
	}

	logger.Logger.Info("Server exited gracefully")
}

// Dependencies holds all initialized dependencies for the application.
type Dependencies struct {
	repo           repository.ActivityRepository
	authMiddleware server.AuthMiddleware
	corsHandler    *cors.Handler
	sportConfig    *config.SportConfig
}

// Close releases all dependency resources.
func (d *Dependencies) Close() {
	if d.repo != nil {
		if err := d.repo.Close(); err != nil {
			logger.Logger.Error("Error closing repository", "error", err)
		}
	}
}

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
func initDependencies(ctx context.Context) (*Dependencies, error) {
	deps := &Dependencies{}

	// 1. Load sport configuration (embedded in binary via go:embed)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		return nil, fmt.Errorf("failed to load sport config: %w", err)
	}
	logger.Logger.Info("Loaded sport config", "sport_count", len(sportConfig.ListSports()))
	deps.sportConfig = sportConfig

	// 2. Initialize CORS handler
	deps.corsHandler = cors.NewHandler()

	// 3. Initialize auth middleware (Firebase JWT + email allowlist)
	authMiddleware, err := middleware.NewFirebaseAuth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth middleware: %w", err)
	}
	deps.authMiddleware = authMiddleware

	// 4. Initialize PostgreSQL repository
	pool, err := postgres.NewPool(ctx)
	if err != nil {
		// Graceful degradation: warn but don't fail startup
		// This allows the service to start even if database is temporarily unavailable
		logger.Logger.Warn("Database initialization failed, continuing without database",
			"error", err)
	} else {
		deps.repo = postgres.NewActivityRepository(pool)
		logger.Logger.Info("Database repository initialized")
	}

	return deps, nil
}

// buildRouter creates the HTTP router with all handlers wired up.
func buildRouter(deps *Dependencies) http.Handler {
	// Create feature handlers with their dependencies
	healthHandler := health.NewHandler(deps.repo, deps.corsHandler)
	sportsHandler := sports.NewHandler(deps.corsHandler)
	activitiesHandler := activities.NewHandler(deps.repo, deps.sportConfig, deps.corsHandler)

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

	return server.NewRouter(routerCfg, publicRoutes, authRoutes)
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
