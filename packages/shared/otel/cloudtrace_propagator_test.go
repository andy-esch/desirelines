package otel

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

func TestCloudTraceOneWayPropagator_Extract(t *testing.T) {
	tests := []struct {
		name        string
		header      string
		wantTraceID string
		wantSampled bool
		wantValid   bool
	}{
		{
			name:        "valid header sampled",
			header:      "105445aa7843bc8bf206b12000100000/1;o=1",
			wantTraceID: "105445aa7843bc8bf206b12000100000",
			wantSampled: true,
			wantValid:   true,
		},
		{
			name:        "valid header unsampled",
			header:      "105445aa7843bc8bf206b12000100000/1;o=0",
			wantTraceID: "105445aa7843bc8bf206b12000100000",
			wantSampled: false,
			wantValid:   true,
		},
		{
			name:        "valid header sampled with bitmask (o=3)",
			header:      "105445aa7843bc8bf206b12000100000/1;o=3",
			wantTraceID: "105445aa7843bc8bf206b12000100000",
			wantSampled: true,
			wantValid:   true,
		},
		{
			name:        "valid header unsampled with bitmask (o=2)",
			header:      "105445aa7843bc8bf206b12000100000/1;o=2",
			wantTraceID: "105445aa7843bc8bf206b12000100000",
			wantSampled: false,
			wantValid:   true,
		},
		{
			name:        "valid header without flags",
			header:      "105445aa7843bc8bf206b12000100000/123456789",
			wantTraceID: "105445aa7843bc8bf206b12000100000",
			wantSampled: false,
			wantValid:   true,
		},
		{
			name:      "empty header",
			header:    "",
			wantValid: false,
		},
		{
			name:      "malformed header",
			header:    "invalid-header-format",
			wantValid: false,
		},
		{
			name:      "all zeros trace ID",
			header:    "00000000000000000000000000000000/1;o=1",
			wantValid: false,
		},
		{
			name:      "zero span ID",
			header:    "105445aa7843bc8bf206b12000100000/0;o=1",
			wantValid: false,
		},
		{
			name:      "span ID uint64 overflow",
			header:    "105445aa7843bc8bf206b12000100000/18446744073709551616;o=1",
			wantValid: false,
		},
	}

	prop := cloudTraceOneWayPropagator{}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			carrier := propagation.MapCarrier{}
			if tc.header != "" {
				carrier.Set("x-cloud-trace-context", tc.header)
			}

			ctx := prop.Extract(context.Background(), carrier)
			sc := trace.SpanContextFromContext(ctx)

			if tc.wantValid {
				if !sc.IsValid() {
					t.Fatalf("expected valid span context, got invalid")
				}
				if got := sc.TraceID().String(); got != tc.wantTraceID {
					t.Errorf("trace ID = %s, want %s", got, tc.wantTraceID)
				}
				if sc.IsSampled() != tc.wantSampled {
					t.Errorf("isSampled = %v, want %v", sc.IsSampled(), tc.wantSampled)
				}
				if !sc.IsRemote() {
					t.Errorf("expected remote span context")
				}
			} else if sc.IsValid() {
				t.Errorf("expected invalid span context, got %#v", sc)
			}
		})
	}
}

func TestCloudTraceOneWayPropagator_InjectIsNoop(t *testing.T) {
	prop := cloudTraceOneWayPropagator{}
	carrier := propagation.MapCarrier{}

	tid, err := trace.TraceIDFromHex("105445aa7843bc8bf206b12000100000")
	if err != nil {
		t.Fatalf("TraceIDFromHex: %v", err)
	}
	sid, err := trace.SpanIDFromHex("0000000000000001")
	if err != nil {
		t.Fatalf("SpanIDFromHex: %v", err)
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    tid,
		SpanID:     sid,
		TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)

	prop.Inject(ctx, carrier)
	if len(carrier) != 0 {
		t.Errorf("expected carrier to be empty after Inject, got %#v", carrier)
	}
	if len(prop.Fields()) != 0 {
		t.Errorf("expected Fields() to be empty, got %#v", prop.Fields())
	}
}
