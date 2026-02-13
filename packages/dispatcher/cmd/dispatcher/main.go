// Package main provides the HTTP server entrypoint for the Strava webhook dispatcher.
// Designed for Cloud Run deployment with graceful shutdown support.
//
// This file serves as the composition root - it wires together all dependencies
// following hexagonal architecture principles. Dependencies flow inward:
//
//	main.go → handler → port interfaces → adapters (pubsub, strava, env)
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	envadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	httpadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/http"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/pubsub"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/strava"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
)

const (
	// startupTimeout is the maximum time allowed for initializing dependencies
	// (e.g., PubSub gRPC connection). Prevents indefinite hang if GCP metadata
	// service is unreachable.
	startupTimeout = 10 * time.Second

	// shutdownTimeout is the maximum time allowed for graceful shutdown.
	shutdownTimeout = 10 * time.Second

	// closeTimeout is the maximum time allowed for closing resources.
	closeTimeout = 5 * time.Second
)

func main() {
	// Logger configured for GCP Cloud Logging. See packages/shared/gcplog/README.md
	log := gcplog.NewWithLevel(config.ParseLogLevel())
	log.Info("Starting dispatcher service")

	if err := run(log); err != nil {
		log.Error("Application failed", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize all dependencies
	deps, err := initDependencies(cfg, log)
	if err != nil {
		return fmt.Errorf("failed to initialize dependencies: %w", err)
	}
	defer deps.Close()

	// Build router
	router := deps.handler.RegisterRoutes()

	port := config.GetEnvOrDefault("PORT", "8080")
	log.Info("Server listening", "port", port)

	// Create server with configurable timeouts for security
	// #nosec G114 - Timeouts are configured via environment variables
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	// Error channel to capture server errors
	serverErrors := make(chan error, 1)
	// Signal channel for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		if serverErr := server.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
			serverErrors <- fmt.Errorf("server error: %w", serverErr)
		}
	}()

	// Block until signal or error
	select {
	case srvErr := <-serverErrors:
		return srvErr
	case <-sigChan:
		log.Info("Shutting down gracefully...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if shutdownErr := server.Shutdown(shutdownCtx); shutdownErr != nil {
		return fmt.Errorf("server shutdown error: %w", shutdownErr)
	}

	log.Info("Shutdown complete")
	return nil
}

// Dependencies holds all initialized dependencies for the dispatcher.
type Dependencies struct {
	publisher *pubsub.Publisher
	handler   *httpadapter.Handler
	logger    *slog.Logger
}

// Close releases all dependency resources.
func (d *Dependencies) Close() {
	closeCtx, cancel := context.WithTimeout(context.Background(), closeTimeout)
	defer cancel()
	if err := d.publisher.Close(closeCtx); err != nil {
		d.logger.Error("Failed to close publisher", "error", err)
	}
}

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
func initDependencies(cfg *config.Config, log *slog.Logger) (*Dependencies, error) {
	startupCtx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()

	publisher, err := pubsub.NewPublisher(startupCtx, cfg.GCPProjectID, cfg.GCPPubSubTopicID, log)
	if err != nil {
		return nil, fmt.Errorf("pubsub publisher: %w", err)
	}

	secretProvider := envadapter.NewDefaultSecretCache(log)

	stravaClient, err := strava.NewClient(log)
	if err != nil {
		return nil, fmt.Errorf("strava client: %w", err)
	}

	// Rate limiter: 5 req/s, burst 10 (Strava sends a few events/day normally)
	// Uses Background context (not startupCtx) because the cleanup goroutine must
	// run for the lifetime of the process — startupCtx is canceled after 10s.
	rateLimiter := ratelimit.New(context.Background(), ratelimit.Config{
		Rate:  5,
		Burst: 10,
	}, log)

	handler := httpadapter.NewHandler(publisher, secretProvider, stravaClient, log, &httpadapter.HandlerConfig{
		MaxRequestBodySize: cfg.MaxRequestBodySize,
		RateLimiter:        rateLimiter,
	})

	return &Dependencies{
		publisher: publisher,
		handler:   handler,
		logger:    log,
	}, nil
}
