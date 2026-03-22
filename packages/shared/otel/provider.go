// Package otel provides OpenTelemetry metrics and tracing setup for GCP.
//
// Usage:
//
//	providers, shutdown, err := otel.Setup(ctx, logger, "service-name")
//	if err != nil {
//	    logger.Warn("OTel disabled", "error", err)
//	    providers = otel.NoopProviders()
//	}
//	defer shutdown(ctx)
//	// Use providers.Meter for instruments, providers.Tracer for spans.
package otel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	mexporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"go.opentelemetry.io/contrib/detectors/gcp"
	otelglobal "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

const (
	// exportInterval matches Cloud Monitoring's minimum resolution for custom metrics.
	exportInterval = 60 * time.Second

	// scopeName is the instrumentation scope name for all desirelines instruments.
	scopeName = "desirelines.io"
)

// Providers holds the initialized OTel meter and tracer.
type Providers struct {
	Meter  metric.Meter
	Tracer trace.Tracer
}

// ShutdownFunc gracefully flushes and shuts down the OTel providers.
type ShutdownFunc func(ctx context.Context) error

// Setup initializes OpenTelemetry MeterProvider and TracerProvider with GCP exporters.
// Returns Providers (meter + tracer), a shutdown function, and any error.
// On error, callers should log a warning and use NoopProviders() — services must not
// crash due to OTel initialization failures.
func Setup(ctx context.Context, logger *slog.Logger, serviceName string) (*Providers, ShutdownFunc, error) {
	res, err := resource.New(ctx,
		resource.WithDetectors(gcp.NewDetector()),
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("create OTel resource: %w", err)
	}

	// --- Metrics ---
	metricExp, err := mexporter.New()
	if err != nil {
		return nil, nil, fmt.Errorf("create GCP metric exporter: %w", err)
	}

	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp, sdkmetric.WithInterval(exportInterval))),
		sdkmetric.WithResource(res),
	)

	// --- Tracing ---
	traceExp, err := texporter.New()
	if err != nil {
		return nil, nil, fmt.Errorf("create GCP trace exporter: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	// Register globally so otelhttp and propagation.Inject/Extract work.
	otelglobal.SetTracerProvider(tp)
	otelglobal.SetTextMapPropagator(propagation.TraceContext{})

	logger.Info("OTel initialized",
		"service", serviceName,
		"metrics_export_interval", exportInterval,
		"trace_sampler", "AlwaysSample",
	)

	shutdown := func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}

	return &Providers{
		Meter:  mp.Meter(scopeName),
		Tracer: tp.Tracer(scopeName),
	}, shutdown, nil
}

// NoopProviders returns no-op Providers for use when OTel setup fails.
func NoopProviders() *Providers {
	return &Providers{
		Meter:  noop.NewMeterProvider().Meter(scopeName),
		Tracer: tracenoop.NewTracerProvider().Tracer(scopeName),
	}
}

// NoopMeter returns a no-op Meter for use when OTel setup fails.
//
// Deprecated: prefer NoopProviders().Meter.
func NoopMeter() metric.Meter {
	return noop.NewMeterProvider().Meter(scopeName)
}
