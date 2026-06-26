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
	"os"
	"time"

	mexporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	gcppropagator "github.com/GoogleCloudPlatform/opentelemetry-operations-go/propagator"
	"go.opentelemetry.io/contrib/detectors/gcp"
	otelglobal "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
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

// extendedDurationBuckets resolves long-tail latency past the default 10s
// ceiling. The OTel SDK default boundaries top out at 10000ms, which clipped
// the P99 of http/request.duration and postgres/query.duration to ~9950ms in
// prod — Neon scale-to-zero wake-ups dominate the tail. Boundaries below keep
// fine resolution in the sub-second range (where typical traffic lives) and
// add coarse resolution out to 60s for cold-start visibility.
var extendedDurationBuckets = []float64{
	1, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000,
	2500, 5000, 7500, 10000, 15000, 30000, 60000,
}

// extendedDurationInstrumentNames lists every desirelines `.duration`
// histogram. Each gets a View that overrides its bucket boundaries to
// extendedDurationBuckets. Listed explicitly (rather than wildcard-matched
// by name or unit) so the override documents intent per-instrument and
// typos surface via provider_test.go.
var extendedDurationInstrumentNames = []string{
	"desirelines.io/http/request.duration",
	"desirelines.io/postgres/query.duration",
	"desirelines.io/strava/api.duration",
	"desirelines.io/firestore/operation.duration",
	"desirelines.io/pubsub/publish.duration",
	"desirelines.io/auth/verify_id_token.duration",
	"desirelines.io/strava/oauth_exchange.duration",
}

// newMeterProvider constructs the SDK MeterProvider with the project's
// standard resource and View configuration. Extracted from Setup so the
// View wiring can be exercised with a ManualReader in provider_test.go
// without instantiating the real GCP exporter.
func newMeterProvider(res *resource.Resource, reader sdkmetric.Reader) *sdkmetric.MeterProvider {
	return sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(reader),
		sdkmetric.WithResource(res),
		sdkmetric.WithView(extendedDurationViews()...),
	)
}

// newPropagator builds the composite text-map propagator that Setup
// registers globally. Extracted so its extract precedence can be
// exercised in provider_test.go without running the full Setup (which
// needs GCP credentials for the exporters).
//
// It ensures a single trace_id flows from Cloud Run's
// X-Cloud-Trace-Context header through OTel spans, Go logs, and
// downstream Python services.
//
// CloudTraceOneWayPropagator (extract-only) reads the GCP trace context
// from the incoming X-Cloud-Trace-Context header injected by Cloud Run.
// It is listed first so that when an incoming request carries BOTH
// headers, TraceContext (W3C) extracts second and takes precedence —
// the correct behavior for service-to-service calls that already
// propagate traceparent. For the dispatcher's entry point (called by
// Strava), only X-Cloud-Trace-Context is present, so the GCP propagator
// supplies the trace_id that OTel adopts. This makes the OTel trace_id
// match the one that gcplog.WithCloudTraceContext writes into
// structured log fields, so Cloud Trace's "Show logs" feature works.
//
// TraceContext (W3C) handles outgoing propagation via traceparent. The
// dispatcher injects it into PubSub message attributes
// (dispatcher/adapters/pubsub/publisher.go); Python workers extract it
// via stravapipe/shared/tracing.py's extract_context_from_attributes(),
// so their spans appear as children of the dispatcher's pubsub.publish
// span with a single unified trace_id across services.
//
// Baggage is included for future use (e.g., propagating correlation_id).
func newPropagator() propagation.TextMapPropagator {
	return propagation.NewCompositeTextMapPropagator(
		gcppropagator.CloudTraceOneWayPropagator{},
		propagation.TraceContext{},
		propagation.Baggage{},
	)
}

// extendedDurationViews returns one View per name in
// extendedDurationInstrumentNames, each applying extendedDurationBuckets.
func extendedDurationViews() []sdkmetric.View {
	views := make([]sdkmetric.View, len(extendedDurationInstrumentNames))
	for i, name := range extendedDurationInstrumentNames {
		views[i] = sdkmetric.NewView(
			// Kind filter is defensive: if someone later adds a counter
			// with one of these names, it shouldn't accidentally pick up
			// histogram bucket boundaries.
			sdkmetric.Instrument{Name: name, Kind: sdkmetric.InstrumentKindHistogram},
			sdkmetric.Stream{
				Aggregation: sdkmetric.AggregationExplicitBucketHistogram{
					Boundaries: extendedDurationBuckets,
				},
			},
		)
	}
	return views
}

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
	return setup(ctx, logger, serviceName, newMetricReader, newTraceExporter)
}

// setup is the testable core of Setup. The metricReaderFn and traceExporterFn
// parameters let tests substitute credential-free fakes (e.g. a ManualReader)
// and a failing trace-exporter constructor, so the partial-failure cleanup
// path can be exercised without GCP credentials.
func setup(
	ctx context.Context,
	logger *slog.Logger,
	serviceName string,
	metricReaderFn func() (sdkmetric.Reader, error),
	traceExporterFn func(context.Context) (sdktrace.SpanExporter, error),
) (*Providers, ShutdownFunc, error) {
	// shutdownFuncs accumulates each provider's shutdown function as it is
	// constructed. If a later construction step fails, handleErr runs all
	// accumulated funcs so an already-initialized provider (and its background
	// reader goroutine / export connection) does not leak. On success they are
	// composed into the returned ShutdownFunc. This is the canonical OTel SDK
	// setup shape (see go.opentelemetry.io/otel docs' setupOTelSDK example).
	var shutdownFuncs []func(context.Context) error
	shutdown := func(ctx context.Context) error {
		var err error
		for _, fn := range shutdownFuncs {
			err = errors.Join(err, fn(ctx))
		}
		shutdownFuncs = nil
		return err
	}
	handleErr := func(cause error) error {
		return errors.Join(cause, shutdown(ctx))
	}

	res, err := resource.New(ctx,
		resource.WithDetectors(gcp.NewDetector()),
		resource.WithAttributes(semconv.ServiceName(serviceName)),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("create OTel resource: %w", err)
	}

	// --- Metrics ---
	reader, err := metricReaderFn()
	if err != nil {
		return nil, nil, fmt.Errorf("create metric reader: %w", err)
	}

	mp := newMeterProvider(res, reader)
	shutdownFuncs = append(shutdownFuncs, mp.Shutdown)

	// --- Tracing ---
	traceExp, err := traceExporterFn(ctx)
	if err != nil {
		// Tear down the already-constructed MeterProvider (and its periodic
		// reader) before returning, so it does not leak on partial failure.
		return nil, nil, handleErr(fmt.Errorf("create trace exporter: %w", err))
	}

	// Sampler: AlwaysSample is intentional. Request volume across dispatcher
	// and apigateway is currently low enough that Cloud Trace ingestion cost
	// is negligible, and 100% sampling gives us full trace fidelity for
	// debugging — every user-reported bug has a trace, every error path is
	// captured. Revisit if monthly ingestion starts showing in billing or
	// if Cloud Trace search latency degrades. When that day comes, the
	// right replacement is ParentBased(TraceIDRatioBased(X)) with the
	// error path force-sampled via a custom sampler (so failures are never
	// dropped). Do not silently lower this to a ratio without pairing it
	// with error-path force-sampling.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	shutdownFuncs = append(shutdownFuncs, tp.Shutdown)

	// Register globally so otelhttp and propagation.Inject/Extract work.
	otelglobal.SetTracerProvider(tp)
	otelglobal.SetTextMapPropagator(newPropagator())

	// The MeterProvider (mp) is deliberately NOT registered globally: we hand
	// providers.Meter out by explicit DI and thread it through callers. The
	// cost of that choice — otelhttp's built-in HTTP server metrics
	// (http.server.{duration,request.size,response.size}), and any library that
	// reaches for otel.GetMeterProvider() (HTTP/gRPC clients, future contrib
	// instrumentations) — route to the global no-op MeterProvider and silently
	// vanish. Our HTTP latency is covered explicitly by
	// gcplog.HTTPRequestLoggerWithMetrics (desirelines.io/http/request.duration);
	// the request/response size histograms have no equivalent and are
	// intentionally dropped. If you add a contrib instrumentation that needs
	// auto-metrics, register mp globally here too (otelglobal.SetMeterProvider).

	logger.Info("OTel initialized",
		"service", serviceName,
		"metrics_export_interval", exportInterval,
		"trace_sampler", "AlwaysSample",
	)

	return &Providers{
		Meter:  mp.Meter(scopeName),
		Tracer: tp.Tracer(scopeName),
	}, shutdown, nil
}

// newMetricReader builds the production metric Reader: a PeriodicReader
// wrapping the GCP Cloud Monitoring exporter, exporting on exportInterval.
// Extracted from Setup so the reader can be substituted with a ManualReader
// in provider_test.go (the GCP exporter needs credentials at construction).
func newMetricReader() (sdkmetric.Reader, error) {
	metricExp, err := mexporter.New()
	if err != nil {
		return nil, fmt.Errorf("create GCP metric exporter: %w", err)
	}
	return sdkmetric.NewPeriodicReader(metricExp, sdkmetric.WithInterval(exportInterval)), nil
}

// newTraceExporter returns an OTLP trace exporter when one of the standard
// OTel endpoint env vars is set, otherwise the GCP Cloud Trace exporter.
//
// The OTLP path is for local debugging — point OTEL_EXPORTER_OTLP_ENDPOINT
// at a local Collector or Jaeger to inspect spans off-process. Production
// deploys leave the env vars unset and fall through to Cloud Trace.
//
// The OTLP SDK reads the endpoint, headers, protocol, etc. directly from
// the standard OTEL_EXPORTER_OTLP_* env vars — we don't decode them here.
// gRPC is the default protocol; if HTTP/protobuf is ever needed, switch
// the import to `otlptracehttp` (this helper would then branch on
// `OTEL_EXPORTER_OTLP_PROTOCOL`).
func newTraceExporter(ctx context.Context) (sdktrace.SpanExporter, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" ||
		os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") != "" {
		exp, err := otlptracegrpc.New(ctx)
		if err != nil {
			return nil, fmt.Errorf("create OTLP trace exporter: %w", err)
		}
		return exp, nil
	}
	exp, err := texporter.New()
	if err != nil {
		return nil, fmt.Errorf("create GCP trace exporter: %w", err)
	}
	return exp, nil
}

// NoopProviders returns no-op Providers for use when OTel setup fails.
func NoopProviders() *Providers {
	return &Providers{
		Meter:  noop.NewMeterProvider().Meter(scopeName),
		Tracer: tracenoop.NewTracerProvider().Tracer(scopeName),
	}
}
