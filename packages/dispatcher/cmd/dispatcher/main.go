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
	"github.com/andy-esch/desirelines/packages/shared/allowlist"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/andy-esch/desirelines/packages/shared/secrets"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
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

	// Initialize OTel metrics + tracing (warn and continue with no-ops on failure)
	providers, otelShutdown, otelErr := otel.Setup(context.Background(), log, "desirelines-dispatcher")
	if otelErr != nil {
		log.Warn("OTel disabled, using no-op providers", "error", otelErr)
		providers = otel.NoopProviders()
	} else {
		defer func() {
			// Bound the flush so a stuck span/metric exporter cannot hang
			// process exit indefinitely. Reuse the same budget as the HTTP
			// server shutdown below.
			shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			defer cancel()
			if shutdownErr := otelShutdown(shutdownCtx); shutdownErr != nil {
				log.Error("OTel shutdown error", "error", shutdownErr)
			}
		}()
	}

	// Initialize all dependencies
	deps, err := initDependencies(cfg, log, providers.Meter, providers.Tracer)
	if err != nil {
		return fmt.Errorf("failed to initialize dependencies: %w", err)
	}
	defer deps.Close()

	// Build router. Wrap with otelhttp at the composition root so Cloud Trace
	// gets a server span per request and the gcplog middleware adopts its
	// trace_id for log correlation. Span name is formatted as "METHOD /path"
	// (e.g. "POST /webhook") — dispatcher paths are low-cardinality
	// (/webhook, /health, /), so using the raw path is safe and avoids the
	// chi-route-pattern lookup apigateway needs.
	//
	// Unlike apigateway, dispatcher does NOT use WithPublicEndpointFn —
	// callers are trusted (PubSub push, Cloud Scheduler) gated by Cloud Run
	// IAM, so propagating the caller's traceparent is correct.
	router := otelhttp.NewHandler(
		deps.handler.RegisterRoutes(),
		"dispatcher",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)

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
	deauthPublisher *pubsub.Publisher
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
	if err := d.deauthPublisher.Close(closeCtx); err != nil {
		d.logger.Error("Failed to close deauth publisher", "error", err)
	}
	if err := d.firestoreClient.Close(); err != nil {
		d.logger.Error("Failed to close Firestore client", "error", err)
	}
}

// newHistogram creates a millisecond-unit Float64Histogram, warning
// (non-fatally) on failure. The returned instrument is usable regardless —
// OTel returns a no-op on error.
func newHistogram(meter metric.Meter, log *slog.Logger, name, desc string) metric.Float64Histogram {
	h, err := meter.Float64Histogram(name, metric.WithUnit("ms"), metric.WithDescription(desc))
	if err != nil {
		log.Warn("Failed to create histogram", "name", name, "error", err)
	}
	return h
}

// newCounter creates an Int64Counter, warning (non-fatally) on failure.
// The returned instrument is usable regardless — OTel returns a no-op on error.
func newCounter(meter metric.Meter, log *slog.Logger, name, desc string) metric.Int64Counter {
	c, err := meter.Int64Counter(name, metric.WithDescription(desc))
	if err != nil {
		log.Warn("Failed to create counter", "name", name, "error", err)
	}
	return c
}

// initDependencies creates and wires all application dependencies.
// This is the composition root following hexagonal architecture.
func initDependencies(cfg *config.Config, log *slog.Logger, meter metric.Meter, tracer trace.Tracer) (*Dependencies, error) {
	startupCtx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()

	// 1. Create OTel instruments first so they can be injected into adapters.
	// Errors are non-fatal; instruments will be no-op on failure.
	stravaHist := newHistogram(meter, log, "desirelines.io/strava/api.duration", "Strava API call duration")
	firestoreHist := newHistogram(meter, log, "desirelines.io/firestore/operation.duration", "Firestore operation duration")
	pubsubHist := newHistogram(meter, log, "desirelines.io/pubsub/publish.duration", "PubSub publish duration")
	webhookCounter := newCounter(meter, log, "desirelines.io/webhook/events", "Webhook events processed")
	ownerCheckCounter := newCounter(meter, log, "desirelines.io/webhook/owner_check", "Webhook owner allowlist check outcomes (allowed/stray/orphan/error)")
	httpHist := newHistogram(meter, log, "desirelines.io/http/request.duration", "HTTP request duration")

	// 2. Initialize infrastructure adapters
	publisher, err := pubsub.NewPublisher(startupCtx, cfg.GCPProjectID, cfg.GCPPubSubTopicID, log, pubsubHist, tracer)
	if err != nil {
		return nil, fmt.Errorf("pubsub publisher: %w", err)
	}

	deauthPublisher, err := pubsub.NewPublisher(startupCtx, cfg.GCPProjectID, cfg.GCPPubSubDeauthTopicID, log, pubsubHist, tracer)
	if err != nil {
		return nil, fmt.Errorf("pubsub deauth publisher: %w", err)
	}

	firestoreClient, err := firestore.NewClientWithDatabase(startupCtx, cfg.GCPProjectID, cfg.FirestoreDatabase)
	if err != nil {
		return nil, fmt.Errorf("firestore client: %w", err)
	}
	log.Info("Firestore client initialized", "database", cfg.FirestoreDatabase)

	tokenStore := firestoreadapter.NewTokenStore(firestoreClient, log, firestoreHist, tracer)
	allowChecker := allowlist.NewFirestoreChecker(firestoreClient, log)

	secretProvider := envadapter.NewDefaultSecretCache(log)

	stravaClientID, err := secrets.LoadFromMount(config.SecretPathStravaClientID, "STRAVA_CLIENT_ID")
	if err != nil {
		return nil, fmt.Errorf("strava client_id: %w", err)
	}
	stravaClientSecret, err := secrets.LoadFromMount(config.SecretPathStravaClientSecret, "STRAVA_CLIENT_SECRET")
	if err != nil {
		return nil, fmt.Errorf("strava client_secret: %w", err)
	}

	stravaClient := strava.NewClient(stravaClientID, stravaClientSecret, tokenStore, log, stravaHist, tracer)

	// Rate limiter: 5 req/s, burst 10 (Strava sends a few events/day normally)
	// Uses Background context (not startupCtx) because the cleanup goroutine must
	// run for the lifetime of the process — startupCtx is canceled after 10s.
	rateLimiter := ratelimit.New(context.Background(), &ratelimit.Config{
		Rate:  5,
		Burst: 10,
		Name:  "dispatcher",
		Meter: meter,
		// Exempt liveness/health probes so GCP uptime checks + Cloud Run probes
		// (every ~60s, from many regional IPs) never consume rate-limit tokens.
		// Mirrors requestLogger's probe-path exclusion.
		Skip: func(r *http.Request) bool {
			return r.URL.Path == "/health" || (r.Method == http.MethodHead && r.URL.Path == "/")
		},
	}, log)

	handler := httpadapter.NewHandler(publisher, deauthPublisher, secretProvider, stravaClient, tokenStore, allowChecker, log, &httpadapter.HandlerConfig{
		MaxRequestBodySize: cfg.MaxRequestBodySize,
		RateLimiter:        rateLimiter,
		WebhookCounter:     webhookCounter,
		OwnerCheckCounter:  ownerCheckCounter,
		HTTPHistogram:      httpHist,
		Tracer:             tracer,
	})

	return &Dependencies{
		publisher:       publisher,
		deauthPublisher: deauthPublisher,
		firestoreClient: firestoreClient,
		handler:         handler,
		logger:          log,
	}, nil
}
