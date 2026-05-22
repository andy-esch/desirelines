package otel

import (
	"context"
	"testing"

	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/trace"
)

// TestExtendedDurationViews_MatchEachListedInstrument asserts that every name
// in extendedDurationInstrumentNames is covered by exactly one View that
// overrides the histogram bucket boundaries to extendedDurationBuckets.
//
// The redundant re-declaration of expected names below is intentional — it
// catches typos that would otherwise propagate from the production list into
// the views without surfacing. If you rename an instrument, update both.
func TestExtendedDurationViews_MatchEachListedInstrument(t *testing.T) {
	expectedNames := []string{
		"desirelines.io/http/request.duration",
		"desirelines.io/postgres/query.duration",
		"desirelines.io/strava/api.duration",
		"desirelines.io/firestore/operation.duration",
		"desirelines.io/pubsub/publish.duration",
		"desirelines.io/auth/verify_id_token.duration",
		"desirelines.io/strava/oauth_exchange.duration",
	}

	views := extendedDurationViews()
	if len(views) != len(expectedNames) {
		t.Fatalf("view count mismatch: got %d, want %d", len(views), len(expectedNames))
	}

	for _, name := range expectedNames {
		t.Run(name, func(t *testing.T) {
			instrument := sdkmetric.Instrument{
				Name: name,
				Kind: sdkmetric.InstrumentKindHistogram,
				Unit: "ms",
			}
			matched := 0
			for _, v := range views {
				stream, ok := v(instrument)
				if !ok {
					continue
				}
				matched++
				agg, ok := stream.Aggregation.(sdkmetric.AggregationExplicitBucketHistogram)
				if !ok {
					t.Fatalf("view for %s produced wrong aggregation type %T", name, stream.Aggregation)
				}
				if len(agg.Boundaries) == 0 || agg.Boundaries[len(agg.Boundaries)-1] != 60000 {
					t.Fatalf("view for %s did not apply extendedDurationBuckets (last boundary = %v)", name, agg.Boundaries)
				}
			}
			if matched != 1 {
				t.Fatalf("expected exactly one view to match %s, got %d", name, matched)
			}
		})
	}
}

// TestNewMeterProvider_AppliesExtendedDurationViewsToHistograms asserts that
// the MeterProvider returned by newMeterProvider actually wires the View
// configuration through — recording a value into one of the extended-bucket
// instruments must produce a HistogramDataPoint whose Bounds end at 60000ms,
// not the SDK default of 10000ms. This catches drift between
// extendedDurationViews() and the WithView call in newMeterProvider.
func TestNewMeterProvider_AppliesExtendedDurationViewsToHistograms(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := newMeterProvider(resource.Empty(), reader)

	const instrumentName = "desirelines.io/http/request.duration"
	hist, err := mp.Meter(scopeName).Float64Histogram(instrumentName, otelmetric.WithUnit("ms"))
	if err != nil {
		t.Fatalf("create histogram: %v", err)
	}
	hist.Record(context.Background(), 100.0)

	var rm metricdata.ResourceMetrics
	if collectErr := reader.Collect(context.Background(), &rm); collectErr != nil {
		t.Fatalf("collect: %v", collectErr)
	}

	var bounds []float64
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != instrumentName {
				continue
			}
			data, ok := m.Data.(metricdata.Histogram[float64])
			if !ok {
				t.Fatalf("expected Histogram[float64] for %s, got %T", instrumentName, m.Data)
			}
			if len(data.DataPoints) != 1 {
				t.Fatalf("expected 1 data point, got %d", len(data.DataPoints))
			}
			bounds = data.DataPoints[0].Bounds
		}
	}
	if len(bounds) == 0 {
		t.Fatalf("did not find %s in collected metrics", instrumentName)
	}
	if got := bounds[len(bounds)-1]; got != 60000 {
		t.Fatalf("expected extendedDurationBuckets to be applied (last bound = 60000), got %v (full bounds = %v)", got, bounds)
	}
}

// TestExtendedDurationViews_DoNotMatchUnlistedInstruments asserts that the
// Views do not accidentally apply to non-duration instruments (e.g.,
// webhook/events counter, postgres/pool.connections gauge).
func TestExtendedDurationViews_DoNotMatchUnlistedInstruments(t *testing.T) {
	unlisted := []string{
		"desirelines.io/webhook/events",
		"desirelines.io/webhook/owner_check",
		"desirelines.io/postgres/pool.connections",
		"desirelines.io/something/new.duration", // future-add safety: NOT yet listed
	}

	views := extendedDurationViews()
	for _, name := range unlisted {
		t.Run(name, func(t *testing.T) {
			instrument := sdkmetric.Instrument{Name: name}
			for _, v := range views {
				if _, ok := v(instrument); ok {
					t.Fatalf("view unexpectedly matched %s", name)
				}
			}
		})
	}
}

// TestNewTraceExporter_OTLPBranchWhenEndpointSet verifies that
// `newTraceExporter` takes the OTLP path (not the GCP Cloud Trace path)
// when one of the standard OTel endpoint env vars is set — the switch
// that lets local debugging redirect spans to a Collector / Jaeger
// instead of Cloud Trace.
//
// The GCP branch is intentionally not unit-tested here: `texporter.New()`
// fails without GCP credentials at construction time (verified:
// "no project found with application default credentials"), so it's
// only exercised when a service boots Setup() in a deployed environment.
func TestNewTraceExporter_OTLPBranchWhenEndpointSet(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4317")
	exp, err := newTraceExporter(context.Background())
	if err != nil {
		t.Fatalf("newTraceExporter with OTLP env: %v", err)
	}
	if exp == nil {
		t.Fatal("expected non-nil exporter, got nil")
	}
	t.Cleanup(func() {
		if sdErr := exp.Shutdown(context.Background()); sdErr != nil {
			t.Logf("exporter Shutdown: %v", sdErr)
		}
	})
}

// TestNewTraceExporter_OTLPBranchAlsoTriggeredByTracesEndpoint mirrors
// the above for the trace-specific env var, since the OTel spec defines
// both OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
// and our helper checks either.
func TestNewTraceExporter_OTLPBranchAlsoTriggeredByTracesEndpoint(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "localhost:4317")
	exp, err := newTraceExporter(context.Background())
	if err != nil {
		t.Fatalf("newTraceExporter with TRACES endpoint env: %v", err)
	}
	if exp == nil {
		t.Fatal("expected non-nil exporter, got nil")
	}
	t.Cleanup(func() {
		if sdErr := exp.Shutdown(context.Background()); sdErr != nil {
			t.Logf("exporter Shutdown: %v", sdErr)
		}
	})
}

// TestNewPropagator_W3CWinsWhenBothHeadersPresent pins the composite
// propagator's extract precedence: when an incoming request carries
// BOTH `X-Cloud-Trace-Context` and `traceparent`, the W3C TraceContext
// arm must win (it's registered second, so it extracts last and
// overrides). This is the documented contract — a regression here
// (e.g. someone reorders the composite) would silently fork trace_ids
// between the OTel span and the gcplog log fields.
func TestNewPropagator_W3CWinsWhenBothHeadersPresent(t *testing.T) {
	const w3cTraceID = "11111111111111111111111111111111"
	const gcpTraceID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	carrier := propagation.MapCarrier{
		"traceparent":           "00-" + w3cTraceID + "-2222222222222222-01",
		"x-cloud-trace-context": gcpTraceID + "/1;o=1",
	}
	ctx := newPropagator().Extract(context.Background(), carrier)

	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		t.Fatal("expected a valid span context after extracting both headers")
	}
	if got := sc.TraceID().String(); got != w3cTraceID {
		t.Errorf("trace-id = %s, want %s (W3C traceparent must take precedence over X-Cloud-Trace-Context)", got, w3cTraceID)
	}
}

// TestNewPropagator_AdoptsGCPHeaderWhenOnlyOnePresent covers the
// dispatcher's entry-point case: a request from Strava carries only
// `X-Cloud-Trace-Context` (no W3C header), so the GCP propagator must
// supply the trace_id OTel adopts.
func TestNewPropagator_AdoptsGCPHeaderWhenOnlyOnePresent(t *testing.T) {
	const gcpTraceID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	carrier := propagation.MapCarrier{
		"x-cloud-trace-context": gcpTraceID + "/1;o=1",
	}
	ctx := newPropagator().Extract(context.Background(), carrier)

	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		t.Fatal("expected a valid span context from X-Cloud-Trace-Context alone")
	}
	if got := sc.TraceID().String(); got != gcpTraceID {
		t.Errorf("trace-id = %s, want %s", got, gcpTraceID)
	}
}

// TestNewPropagator_InjectsW3CTraceparent pins the outgoing side: the
// composite must write a `traceparent` header (via the TraceContext
// arm) so downstream services — including the Python workers reading
// PubSub message attributes — can continue the trace.
func TestNewPropagator_InjectsW3CTraceparent(t *testing.T) {
	const traceID = "33333333333333333333333333333333"
	const spanID = "4444444444444444"

	tid, err := trace.TraceIDFromHex(traceID)
	if err != nil {
		t.Fatalf("TraceIDFromHex: %v", err)
	}
	sid, err := trace.SpanIDFromHex(spanID)
	if err != nil {
		t.Fatalf("SpanIDFromHex: %v", err)
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    tid,
		SpanID:     sid,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	ctx := trace.ContextWithRemoteSpanContext(context.Background(), sc)

	carrier := propagation.MapCarrier{}
	newPropagator().Inject(ctx, carrier)

	got := carrier.Get("traceparent")
	want := "00-" + traceID + "-" + spanID + "-01"
	if got != want {
		t.Errorf("injected traceparent = %q, want %q", got, want)
	}
}

// TestNoopProviders_ReturnsUsableNoopInstruments locks the
// graceful-degradation contract: when Setup fails, callers fall back
// to NoopProviders(), so its Meter and Tracer must be non-nil and
// usable (creating an instrument / starting a span must not panic or
// error). A service that crashed here would defeat the whole "OTel
// failure must not crash the service" guarantee in Setup's doc.
func TestNoopProviders_ReturnsUsableNoopInstruments(t *testing.T) {
	p := NoopProviders()
	if p == nil {
		t.Fatal("NoopProviders() returned nil")
	}
	if p.Meter == nil {
		t.Error("NoopProviders().Meter is nil")
	}
	if p.Tracer == nil {
		t.Fatal("NoopProviders().Tracer is nil")
	}
	// A no-op instrument must construct without error.
	if _, err := p.Meter.Int64Counter("desirelines.io/test.counter"); err != nil {
		t.Errorf("no-op Meter failed to create a counter: %v", err)
	}
	// A no-op span must start and end without panicking.
	_, span := p.Tracer.Start(context.Background(), "test.span")
	span.End()
}

// TestNoopMeter_ReturnsUsableMeter covers the deprecated NoopMeter
// shim — still exported, so still worth a smoke test that it returns
// a usable Meter.
func TestNoopMeter_ReturnsUsableMeter(t *testing.T) {
	m := NoopMeter()
	if m == nil {
		t.Fatal("NoopMeter() returned nil")
	}
	if _, err := m.Int64Counter("desirelines.io/test.counter"); err != nil {
		t.Errorf("no-op Meter failed to create a counter: %v", err)
	}
}
