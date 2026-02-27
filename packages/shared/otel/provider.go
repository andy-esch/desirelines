// Package otel provides OpenTelemetry metrics setup for GCP Cloud Monitoring.
//
// Usage:
//
//	meter, shutdown, err := otel.Setup(ctx, logger, "service-name")
//	if err != nil {
//	    logger.Warn("OTel metrics disabled", "error", err)
//	    // Use otel.NoopMeter() as fallback
//	}
//	defer shutdown(ctx)
package otel

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	mexporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
	gcpdetector "go.opentelemetry.io/contrib/detectors/gcp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const (
	// exportInterval matches Cloud Monitoring's minimum resolution for custom metrics.
	exportInterval = 60 * time.Second

	// meterName is the instrumentation scope name for all desirelines metrics.
	meterName = "desirelines.io"
)

// ShutdownFunc gracefully flushes and shuts down the meter provider.
type ShutdownFunc func(ctx context.Context) error

// Setup initializes an OpenTelemetry MeterProvider with GCP Cloud Monitoring exporter.
// Returns a Meter for creating instruments, a shutdown function, and any error.
// On error, callers should log a warning and use NoopMeter() — services must not
// crash due to metrics initialization failures.
func Setup(ctx context.Context, logger *slog.Logger, serviceName string) (metric.Meter, ShutdownFunc, error) {
	exporter, err := mexporter.New()
	if err != nil {
		return nil, nil, fmt.Errorf("create GCP metric exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithDetectors(gcpdetector.NewDetector()),
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("create OTel resource: %w", err)
	}

	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter, sdkmetric.WithInterval(exportInterval))),
		sdkmetric.WithResource(res),
	)

	meter := provider.Meter(meterName)
	logger.Info("OTel metrics initialized", "service", serviceName, "export_interval", exportInterval)

	shutdown := func(ctx context.Context) error {
		return provider.Shutdown(ctx)
	}

	return meter, shutdown, nil
}

// NoopMeter returns a no-op Meter for use when OTel setup fails.
func NoopMeter() metric.Meter {
	return noop.NewMeterProvider().Meter(meterName)
}
