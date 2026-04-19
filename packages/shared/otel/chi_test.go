package otel

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestSpanNameFromChiRoute_UpdatesNameOnMatch(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(SpanNameFromChiRoute)
	r.Get("/v1/activities/{year}/metadata", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metadata", nil)
	ctx, span := tr.Start(req.Context(), "initial-name")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	wantName := "GET /v1/activities/{year}/metadata"
	if ended[0].Name() != wantName {
		t.Errorf("span name = %q, want %q", ended[0].Name(), wantName)
	}
}

func TestSpanNameFromChiRoute_NoMatchLeavesNameUnchanged(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(SpanNameFromChiRoute)
	// No routes registered → request will 404.

	req := httptest.NewRequest(http.MethodGet, "/does/not/exist", nil)
	ctx, span := tr.Start(req.Context(), "untouched")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if ended[0].Name() != "untouched" {
		t.Errorf("span name = %q, want %q (should be unchanged on 404)", ended[0].Name(), "untouched")
	}
}

func TestSpanNameFromChiRoute_NoActiveSpanIsNoOp(t *testing.T) {
	// No tracer / no span in context — middleware must not panic.
	r := chi.NewRouter()
	r.Use(SpanNameFromChiRoute)
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}
