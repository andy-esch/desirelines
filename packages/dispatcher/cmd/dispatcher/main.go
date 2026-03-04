// Package main provides the HTTP server entrypoint for the Strava webhook dispatcher.
// Designed for Cloud Run deployment with graceful shutdown support.
//
// This file serves as the composition root - it wires together all dependencies
// following hexagonal architecture principles. Dependencies flow inward:
//
//	main.go → handler → port interfaces → adapters (pubsub, strava, env, firestore)
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

	"cloud.google.com/go/firestore"
	envadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/env"
	firestoreadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/firestore"
	httpadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/http"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/pubsub"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/strava"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/andy-esch/desirelines/packages/shared/secrets"
	"go.opentelemetry.io/otel/metric"
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

	// Initialize OTel metrics (warn and continue with no-op on failure)
	meter, otelShutdown, otelErr := otel.Setup(context.Background(), log, "desirelines-dispatcher")
	if otelErr != nil {
		log.Warn("OTel metrics disabled, using no-op meter", "error", otelErr)
		meter = otel.NoopMeter()
	} else {
		defer func() {
			if shutdownErr := otelShutdown(context.Background()); shutdownErr != nil {
				log.Error("OTel shutdown error", "error", shutdownErr)
			}
		}()
	}

	// Initialize all dependencies
	deps, err := initDependencies(cfg, log, meter)
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
	publisher       *pubsub.Publisher
	firestoreClient *firestore.Client
	handler         *httpadapter.Handler
	logger          *slog.Logger
}

// Close releases all dependency resources.
func (d *Dependencies) Close() {
	closeCtx, cancel := context.WithTimeout(context.Background(), closeTimeout)
	defer cancel()
	if err := d.publisher.Close(closeCtx); err != nil {
		d.logger.Error("Failed to close publisher", "error", err)
	}
	if err := d.firestoreClient.Close(); err != nil {
		d.logger.Error("Failed to close Firestore client", "error", err)
	}
}

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
func initDependencies(cfg *config.Config, log *slog.Logger, meter metric.Meter) (*Dependencies, error) {
	startupCtx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()

	// 1. Create OTel instruments first so they can be injected into adapters.
	// Errors are non-fatal; instruments will be no-op on failure.
	stravaHist, err := meter.Float64Histogram("desirelines.io/strava/api.duration",
		metric.WithUnit("ms"), metric.WithDescription("Strava API call duration"))
	if err != nil {
		log.Warn("Failed to create strava histogram", "error", err)
	}
	firestoreHist, err := meter.Float64Histogram("desirelines.io/firestore/operation.duration",
		metric.WithUnit("ms"), metric.WithDescription("Firestore operation duration"))
	if err != nil {
		log.Warn("Failed to create firestore histogram", "error", err)
	}
	pubsubHist, err := meter.Float64Histogram("desirelines.io/pubsub/publish.duration",
		metric.WithUnit("ms"), metric.WithDescription("PubSub publish duration"))
	if err != nil {
		log.Warn("Failed to create pubsub histogram", "error", err)
	}
	webhookCounter, err := meter.Int64Counter("desirelines.io/webhook/events",
		metric.WithDescription("Webhook events processed"))
	if err != nil {
		log.Warn("Failed to create webhook counter", "error", err)
	}
	httpHist, err := meter.Float64Histogram("desirelines.io/http/request.duration",
		metric.WithUnit("ms"), metric.WithDescription("HTTP request duration"))
	if err != nil {
		log.Warn("Failed to create http histogram", "error", err)
	}

	// 2. Initialize infrastructure adapters
	publisher, err := pubsub.NewPublisher(startupCtx, cfg.GCPProjectID, cfg.GCPPubSubTopicID, log, pubsubHist)
	if err != nil {
		return nil, fmt.Errorf("pubsub publisher: %w", err)
	}

	firestoreClient, err := firestore.NewClientWithDatabase(startupCtx, cfg.GCPProjectID, cfg.FirestoreDatabase)
	if err != nil {
		return nil, fmt.Errorf("firestore client: %w", err)
	}
	log.Info("Firestore client initialized", "database", cfg.FirestoreDatabase)

	tokenStore := firestoreadapter.NewTokenStore(firestoreClient, log, firestoreHist)

	secretProvider := envadapter.NewDefaultSecretCache(log)

	stravaClientID, err := secrets.LoadFromMount(config.SecretPathStravaClientID, "STRAVA_CLIENT_ID")
	if err != nil {
		return nil, fmt.Errorf("strava client_id: %w", err)
	}
	stravaClientSecret, err := secrets.LoadFromMount(config.SecretPathStravaClientSecret, "STRAVA_CLIENT_SECRET")
	if err != nil {
		return nil, fmt.Errorf("strava client_secret: %w", err)
	}

	stravaClient := strava.NewClient(stravaClientID, stravaClientSecret, tokenStore, log, stravaHist)

	// Rate limiter: 5 req/s, burst 10 (Strava sends a few events/day normally)
	// Uses Background context (not startupCtx) because the cleanup goroutine must
	// run for the lifetime of the process — startupCtx is canceled after 10s.
	rateLimiter := ratelimit.New(context.Background(), ratelimit.Config{
		Rate:  5,
		Burst: 10,
	}, log)

	handler := httpadapter.NewHandler(publisher, secretProvider, stravaClient, tokenStore, log, &httpadapter.HandlerConfig{
		MaxRequestBodySize: cfg.MaxRequestBodySize,
		RateLimiter:        rateLimiter,
		WebhookCounter:     webhookCounter,
		HTTPHistogram:      httpHist,
	})

	return &Dependencies{
		publisher:       publisher,
		firestoreClient: firestoreClient,
		handler:         handler,
		logger:          log,
	}, nil
}
