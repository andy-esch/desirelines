// Package main provides the HTTP server entrypoint for the Strava webhook dispatcher.
// Designed for Cloud Run deployment with graceful shutdown support.
package main

import (
	"context"
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

func main() {
	// Logger configured for GCP Cloud Logging. See packages/shared/gcplog/README.md
	log := gcplog.NewWithLevel(config.ParseLogLevel())
	log.Info("Starting dispatcher service")

	ctx := context.Background()

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	// Initialize adapters
	publisher, err := pubsub.NewPublisher(ctx, cfg.GCPProjectID, cfg.GCPPubSubTopicID, log)
	if err != nil {
		log.Error("Failed to initialize PubSub publisher", "error", err)
		os.Exit(1)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if closeErr := publisher.Close(closeCtx); closeErr != nil {
			log.Error("Failed to close publisher", "error", closeErr)
		}
	}()

	secretProvider := envadapter.NewDefaultSecretCache(log)

	stravaClient, err := strava.NewClient(log)
	if err != nil {
		log.Error("Failed to initialize Strava client", "error", err)
		os.Exit(1)
	}

	// Create handler with injected dependencies
	handler := httpadapter.NewHandler(publisher, secretProvider, stravaClient, log, &httpadapter.HandlerConfig{
		MaxRequestBodySize: cfg.MaxRequestBodySize,
	})

	router := handler.RegisterRoutes()

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

		// Create shutdown context with timeout
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Shutdown HTTP server
		if shutdownErr := server.Shutdown(shutdownCtx); shutdownErr != nil {
			log.Error("Server shutdown error", "error", shutdownErr)
		}

		// Close handler resources (PubSub client, etc.)
		if cleanupErr := handler.Close(shutdownCtx); cleanupErr != nil {
			log.Error("Handler cleanup error", "error", cleanupErr)
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
