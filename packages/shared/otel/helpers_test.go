package otel

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestRecordDuration_Success(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	meter := mp.Meter("test")

	hist, err := meter.Float64Histogram("test.duration")
	if err != nil {
		t.Fatalf("Float64Histogram: %v", err)
	}

	done := RecordDuration(context.Background(), hist, attribute.String("operation", "fetch"))
	time.Sleep(2 * time.Millisecond)
	done(nil)

	var rm metricdata.ResourceMetrics
	if collectErr := reader.Collect(context.Background(), &rm); collectErr != nil {
		t.Fatalf("Collect: %v", collectErr)
	}

	if len(rm.ScopeMetrics) == 0 || len(rm.ScopeMetrics[0].Metrics) == 0 {
		t.Fatal("expected at least one metric recorded")
	}

	m := rm.ScopeMetrics[0].Metrics[0]
	if m.Name != "test.duration" {
		t.Errorf("metric name = %s, want test.duration", m.Name)
	}

	hData, ok := m.Data.(metricdata.Histogram[float64])
	if !ok || len(hData.DataPoints) == 0 {
		t.Fatalf("expected histogram data points, got %#v", m.Data)
	}

	dp := hData.DataPoints[0]
	if dp.Count != 1 {
		t.Errorf("count = %d, want 1", dp.Count)
	}
	if dp.Sum < 1.0 {
		t.Errorf("sum = %f ms, expected >= 1.0ms", dp.Sum)
	}

	attrs := dp.Attributes.ToSlice()
	if op, found := findAttr(attrs, "operation"); !found || op.Value.AsString() != "fetch" {
		t.Errorf("expected operation=fetch attribute, got %v", attrs)
	}
	if res, found := findAttr(attrs, "result"); !found || res.Value.AsString() != "success" {
		t.Errorf("expected result=success attribute, got %v", attrs)
	}
}

func TestRecordDuration_Error(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	meter := mp.Meter("test")

	hist, err := meter.Float64Histogram("test.duration")
	if err != nil {
		t.Fatalf("Float64Histogram: %v", err)
	}

	done := RecordDuration(context.Background(), hist, attribute.String("op", "write"))
	done(errors.New("db error"))

	var rm metricdata.ResourceMetrics
	if collectErr := reader.Collect(context.Background(), &rm); collectErr != nil {
		t.Fatalf("Collect: %v", collectErr)
	}

	hData, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
	if !ok || len(hData.DataPoints) == 0 {
		t.Fatalf("expected histogram data points, got %#v", rm.ScopeMetrics[0].Metrics[0].Data)
	}
	dp := hData.DataPoints[0]

	if res, found := findAttr(dp.Attributes.ToSlice(), "result"); !found || res.Value.AsString() != "error" {
		t.Errorf("expected result=error attribute on error callback, got %v", dp.Attributes.ToSlice())
	}
}

func TestRecordDuration_NilHistogram(t *testing.T) {
	done := RecordDuration(context.Background(), nil)
	if done == nil {
		t.Fatal("expected non-nil done callback even when histogram is nil")
	}
	done(nil)
	done(errors.New("error with nil histogram"))
}

func TestStartSpan_Success(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")

	ctx, done := StartSpan(context.Background(), tracer, "test.op", attribute.String("tag", "alpha"))
	if ctx == nil {
		t.Fatal("expected non-nil context from StartSpan")
	}
	done(nil)

	spans := sr.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(spans))
	}
	s := spans[0]
	if s.Name() != "test.op" {
		t.Errorf("span name = %s, want test.op", s.Name())
	}
	if s.Status().Code != codes.Unset {
		t.Errorf("span status = %v, want Unset", s.Status().Code)
	}
	foundTag := false
	for _, a := range s.Attributes() {
		if a.Key == "tag" && a.Value.AsString() == "alpha" {
			foundTag = true
		}
	}
	if !foundTag {
		t.Errorf("expected tag=alpha attribute, got %v", s.Attributes())
	}
}

func TestStartSpan_Error(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")

	wantErr := errors.New("something went wrong")
	_, done := StartSpan(context.Background(), tracer, "test.error.op")
	done(wantErr)

	spans := sr.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(spans))
	}
	s := spans[0]
	if s.Status().Code != codes.Error {
		t.Errorf("span status code = %v, want Error", s.Status().Code)
	}
	if s.Status().Description != wantErr.Error() {
		t.Errorf("span status description = %s, want %s", s.Status().Description, wantErr.Error())
	}
	if len(s.Events()) == 0 {
		t.Error("expected span exception/error event recorded")
	}
}
