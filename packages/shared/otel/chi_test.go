package otel

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/attribute"
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

// Real apigateway registers routes via r.Route + r.Group. Chi's RoutePattern
// stitches the segments together, but pin it down with a test so an upstream
// chi change can't silently produce e.g. "/activities/{year}/metadata".
func TestSpanNameFromChiRoute_SubrouterAndGroup(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(SpanNameFromChiRoute)
	r.Route("/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Get("/activities/{year}/metadata", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			})
		})
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

// Production stack has Recoverer inside SpanNameFromChiRoute. If the handler
// panics, Recoverer catches and writes 500; our defer still needs to read
// RoutePattern (populated by chi pre-dispatch) and rename the span.
func TestSpanNameFromChiRoute_PanicRecoveredStillRenames(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(SpanNameFromChiRoute)
	r.Use(chiMiddleware.Recoverer)
	r.Get("/boom/{id}", func(_ http.ResponseWriter, _ *http.Request) {
		//nolint:forbidigo // deliberate panic to exercise chi middleware recovery path
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/boom/42", nil)
	ctx, span := tr.Start(req.Context(), "initial-name")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	span.End()

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (Recoverer should catch)", w.Code)
	}

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	wantName := "GET /boom/{id}"
	if ended[0].Name() != wantName {
		t.Errorf("span name = %q, want %q", ended[0].Name(), wantName)
	}
}

// findAttr returns the first attribute matching key, or zero value + false.
func findAttr(attrs []attribute.KeyValue, key string) (attribute.KeyValue, bool) {
	for _, a := range attrs {
		if string(a.Key) == key {
			return a, true
		}
	}
	return attribute.KeyValue{}, false
}

func TestAddChiURLParams_SetsAttributesForPresentParams(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Get("/v1/activities/{year}/metadata", func(_ http.ResponseWriter, req *http.Request) {
		AddChiURLParams(req, "year", "missing")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metadata", nil)
	ctx, span := tr.Start(req.Context(), "test")
	req = req.WithContext(ctx)

	r.ServeHTTP(httptest.NewRecorder(), req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	got, ok := findAttr(ended[0].Attributes(), "desirelines.year")
	if !ok || got.Value.AsString() != "2024" {
		t.Errorf("desirelines.year attribute = %v (ok=%v), want 2024", got.Value, ok)
	}
	if _, exists := findAttr(ended[0].Attributes(), "desirelines.missing"); exists {
		t.Errorf("desirelines.missing should not be set when chi.URLParam returns empty")
	}
}

func TestAddChiURLParams_NoActiveSpanIsNoOp(t *testing.T) {
	// No tracer / no span on context — must not panic.
	r := chi.NewRouter()
	r.Get("/v1/activities/{id}", func(_ http.ResponseWriter, req *http.Request) {
		AddChiURLParams(req, "id")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/42", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestStampRequestID_StampsWhenIDPresent(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(StampRequestID)
	r.Get("/x", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	ctx, span := tr.Start(req.Context(), "test")
	ctx = apierrors.WithRequestID(ctx, "req-abc-123")
	req = req.WithContext(ctx)

	r.ServeHTTP(httptest.NewRecorder(), req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	got, ok := findAttr(ended[0].Attributes(), "request_id")
	if !ok || got.Value.AsString() != "req-abc-123" {
		t.Errorf("request_id attribute = %v (ok=%v), want req-abc-123", got.Value, ok)
	}
}

func TestStampRequestID_NoIDInContextIsNoOp(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Use(StampRequestID)
	r.Get("/x", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	ctx, span := tr.Start(req.Context(), "test")
	req = req.WithContext(ctx)

	r.ServeHTTP(httptest.NewRecorder(), req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if _, exists := findAttr(ended[0].Attributes(), "request_id"); exists {
		t.Errorf("request_id should not be set when context has no request ID")
	}
}

func TestStampRequestID_NoActiveSpanIsNoOp(t *testing.T) {
	r := chi.NewRouter()
	r.Use(StampRequestID)
	r.Get("/x", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	ctx := apierrors.WithRequestID(req.Context(), "req-abc-123")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestAddChiURLParamsAs_RemapsParamNameToAttribute(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tr := tp.Tracer("test")

	r := chi.NewRouter()
	r.Get("/v1/activities/{id}", func(_ http.ResponseWriter, req *http.Request) {
		AddChiURLParamsAs(req, map[string]string{"id": "activity_id"})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/42", nil)
	ctx, span := tr.Start(req.Context(), "test")
	req = req.WithContext(ctx)

	r.ServeHTTP(httptest.NewRecorder(), req)
	span.End()

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	got, ok := findAttr(ended[0].Attributes(), "desirelines.activity_id")
	if !ok || got.Value.AsString() != "42" {
		t.Errorf("desirelines.activity_id = %v (ok=%v), want 42", got.Value, ok)
	}
	// The chi param name `id` must NOT also appear — caller asked for the
	// alias and only the alias should be set.
	if _, exists := findAttr(ended[0].Attributes(), "desirelines.id"); exists {
		t.Errorf("desirelines.id should not be set — caller asked for activity_id alias")
	}
}

func TestAddChiURLParamsAs_NoActiveSpanIsNoOp(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/v1/activities/{id}", func(_ http.ResponseWriter, req *http.Request) {
		AddChiURLParamsAs(req, map[string]string{"id": "activity_id"})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/activities/42", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}
