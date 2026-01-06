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

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	httpadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/http"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/pubsub"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/pkg/logger"
)

func main() {
	log := logger.New()
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
		if closeErr := publisher.Close(); closeErr != nil {
			log.Error("Failed to close publisher", "error", closeErr)
		}
	}()

	secretProvider := env.NewDefaultSecretCache(log)

	// Create handler with injected dependencies
	handler := httpadapter.NewHandler(publisher, secretProvider, log)

	router := handler.RegisterRoutes()

	port := config.GetEnvOrDefault("PORT", "8080")
	log.Info("Server listening", "port", port)

	// Create server with timeouts for security
	// #nosec G114 - Timeouts are configured below
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Setup graceful shutdown
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
	}()

	if serverErr := server.ListenAndServe(); serverErr != nil && serverErr != http.ErrServerClosed {
		log.Error("Server error", "error", serverErr)
		os.Exit(1)
	}
}
