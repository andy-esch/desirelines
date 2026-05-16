package otel

import (
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
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
