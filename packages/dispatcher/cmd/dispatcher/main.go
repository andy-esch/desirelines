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

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	// Initialize all dependencies
	deps, err := initDependencies(cfg, log)
	if err != nil {
		log.Error("Failed to initialize dependencies", "error", err)
		os.Exit(1)
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

	// Setup graceful shutdown
	done := make(chan struct{})
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan

		log.Info("Shutting down gracefully...")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if shutdownErr := server.Shutdown(shutdownCtx); shutdownErr != nil {
			log.Error("Server shutdown error", "error", shutdownErr)
		}

		log.Info("Shutdown complete")
		close(done)
	}()

	if serverErr := server.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
		log.Error("Server error", "error", serverErr)
		os.Exit(1)
	}

	<-done
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

	handler := httpadapter.NewHandler(publisher, secretProvider, stravaClient, log, &httpadapter.HandlerConfig{
		MaxRequestBodySize: cfg.MaxRequestBodySize,
	})

	return &Dependencies{
		publisher: publisher,
		handler:   handler,
		logger:    log,
	}, nil
}
