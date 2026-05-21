package otel

import (
	"context"
	"testing"

	otelmetric "go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
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
// when one of the standard OTel endpoint env vars is set. This is the
// switch the e2e test harness relies on — captured spans flow to a local
// Collector / Jaeger instead of leaving the test process.
//
// The GCP branch is intentionally not unit-tested here: `texporter.New()`
// requires GCP credentials at construction time and is exercised by the
// existing Setup() path in deployed CI.
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
