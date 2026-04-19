package gcplog

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/trace"
)

func TestHTTPRequestLogger_LogsRequest(t *testing.T) {
	logger, handler := NewCaptureLogger()

	// Create a simple handler that returns 200
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("OK")); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	// Build the middleware chain
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/test", nextHandler)

	// Make request
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("User-Agent", "test-agent")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Verify response
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify log was captured
	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	log := logs[0]
	if log.Message != "HTTP Request" {
		t.Errorf("expected message 'HTTP Request', got %q", log.Message)
	}
	if log.Level != slog.LevelInfo {
		t.Errorf("expected INFO level for 200 status, got %v", log.Level)
	}

	// Check httpRequest nested structure (GCP format)
	httpReq, ok := log.Attrs["httpRequest"].(map[string]any)
	if !ok {
		t.Fatalf("expected httpRequest group, got %T", log.Attrs["httpRequest"])
	}
	if httpReq["requestMethod"] != "GET" {
		t.Errorf("expected requestMethod GET, got %v", httpReq["requestMethod"])
	}
	if httpReq["requestUrl"] != "/test" {
		t.Errorf("expected requestUrl /test, got %v", httpReq["requestUrl"])
	}
	// slog stores integers as int64
	if httpReq["status"] != int64(200) {
		t.Errorf("expected status 200, got %v", httpReq["status"])
	}
	if httpReq["userAgent"] != "test-agent" {
		t.Errorf("expected userAgent test-agent, got %v", httpReq["userAgent"])
	}
}

func TestHTTPRequestLogger_StatusBasedLevels(t *testing.T) {
	tests := []struct {
		name          string
		status        int
		expectedLevel slog.Level
	}{
		{"200 OK logs INFO", http.StatusOK, slog.LevelInfo},
		{"201 Created logs INFO", http.StatusCreated, slog.LevelInfo},
		{"301 Redirect logs INFO", http.StatusMovedPermanently, slog.LevelInfo},
		{"400 Bad Request logs WARN", http.StatusBadRequest, slog.LevelWarn},
		{"401 Unauthorized logs WARN", http.StatusUnauthorized, slog.LevelWarn},
		{"404 Not Found logs WARN", http.StatusNotFound, slog.LevelWarn},
		{"500 Internal Error logs ERROR", http.StatusInternalServerError, slog.LevelError},
		{"502 Bad Gateway logs ERROR", http.StatusBadGateway, slog.LevelError},
		{"503 Unavailable logs ERROR", http.StatusServiceUnavailable, slog.LevelError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger, handler := NewCaptureLogger()

			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
			})

			r := chi.NewRouter()
			r.Use(middleware.RequestID)
			r.Use(HTTPRequestLogger(logger))
			r.Get("/", nextHandler)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			logs := handler.Logs()
			if len(logs) != 1 {
				t.Fatalf("expected 1 log entry, got %d", len(logs))
			}

			if logs[0].Level != tt.expectedLevel {
				t.Errorf("expected level %v for status %d, got %v", tt.expectedLevel, tt.status, logs[0].Level)
			}
		})
	}
}

func TestHTTPRequestLogger_CapturesBytesWritten(t *testing.T) {
	logger, handler := NewCaptureLogger()

	responseBody := "Hello, World!"
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(responseBody)); err != nil {
			t.Errorf("failed to write response: %v", err)
		}
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	// Check responseSize in httpRequest group
	httpReq, ok := logs[0].Attrs["httpRequest"].(map[string]any)
	if !ok {
		t.Fatalf("expected httpRequest group, got %T", logs[0].Attrs["httpRequest"])
	}
	responseSize, ok := httpReq["responseSize"].(int64)
	if !ok {
		t.Fatalf("expected responseSize to be int64, got %T", httpReq["responseSize"])
	}
	if responseSize != int64(len(responseBody)) {
		t.Errorf("expected responseSize %d, got %d", len(responseBody), responseSize)
	}
}

func TestHTTPRequestLogger_IncludesRequestID(t *testing.T) {
	logger, handler := NewCaptureLogger()

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	requestID, ok := logs[0].Attrs["request_id"].(string)
	if !ok {
		t.Fatalf("expected request_id to be string, got %T", logs[0].Attrs["request_id"])
	}
	if requestID == "" {
		t.Error("expected non-empty request_id")
	}
}

func TestHTTPRequestLogger_IncludesLatency(t *testing.T) {
	logger, handler := NewCaptureLogger()

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := chi.NewRouter()
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	httpReq, ok := logs[0].Attrs["httpRequest"].(map[string]any)
	if !ok {
		t.Fatalf("expected httpRequest group, got %T", logs[0].Attrs["httpRequest"])
	}

	latency, ok := httpReq["latency"].(string)
	if !ok {
		t.Fatalf("expected latency to be string, got %T", httpReq["latency"])
	}
	if latency == "" {
		t.Error("expected non-empty latency")
	}
	// Should end with 's' for seconds format
	if latency[len(latency)-1] != 's' {
		t.Errorf("expected latency to end with 's', got %q", latency)
	}
}

func TestHTTPRequestLogger_RedactsQueryParams(t *testing.T) {
	logger, handler := NewCaptureLogger()

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := chi.NewRouter()
	r.Use(HTTPRequestLogger(logger))
	r.Get("/webhook", nextHandler)

	// Simulate Strava webhook validation with a secret token in the query string
	req := httptest.NewRequest(http.MethodGet, "/webhook?hub.verify_token=s3cret&hub.challenge=abc", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	httpReq, ok := logs[0].Attrs["httpRequest"].(map[string]any)
	if !ok {
		t.Fatalf("expected httpRequest group, got %T", logs[0].Attrs["httpRequest"])
	}

	requestURL, ok := httpReq["requestUrl"].(string)
	if !ok {
		t.Fatalf("expected requestUrl to be string, got %T", httpReq["requestUrl"])
	}
	// Must log only the path, never the query string containing secrets
	if requestURL != "/webhook" {
		t.Errorf("expected requestUrl to be '/webhook' (path only), got %q", requestURL)
	}
}

// runTraceTest is a helper to reduce duplication between GCP and W3C trace tests
func runTraceTest(t *testing.T, headerName, headerValue, expectedTrace, expectedSpan string, expectedSample bool) {
	t.Helper()

	var capturedTC *TraceContext

	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(headerName, headerValue)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if capturedTC == nil {
		t.Fatal("expected trace context to be captured")
	}
	// Without project ID env, trace is just the raw ID
	if capturedTC.TraceID != expectedTrace {
		t.Errorf("traceID = %q, want %q", capturedTC.TraceID, expectedTrace)
	}
	if capturedTC.SpanID != expectedSpan {
		t.Errorf("spanID = %q, want %q", capturedTC.SpanID, expectedSpan)
	}
	if capturedTC.TraceSampled != expectedSample {
		t.Errorf("traceSampled = %v, want %v", capturedTC.TraceSampled, expectedSample)
	}
}

func TestWithCloudTraceContext_GCPHeader(t *testing.T) {
	tests := []struct {
		name           string
		header         string
		expectedTrace  string
		expectedSpan   string
		expectedSample bool
	}{
		{
			name:           "full header with sampling",
			header:         "105445aa7843bc8bf206b120001000/1;o=1",
			expectedTrace:  "105445aa7843bc8bf206b120001000",
			expectedSpan:   "1",
			expectedSample: true,
		},
		{
			name:           "header without sampling",
			header:         "105445aa7843bc8bf206b120001000/2;o=0",
			expectedTrace:  "105445aa7843bc8bf206b120001000",
			expectedSpan:   "2",
			expectedSample: false,
		},
		{
			name:           "header without span",
			header:         "105445aa7843bc8bf206b120001000",
			expectedTrace:  "105445aa7843bc8bf206b120001000",
			expectedSpan:   "",
			expectedSample: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTraceTest(t, "X-Cloud-Trace-Context", tt.header, tt.expectedTrace, tt.expectedSpan, tt.expectedSample)
		})
	}
}

func TestWithCloudTraceContext_W3CTraceparent(t *testing.T) {
	tests := []struct {
		name           string
		header         string
		expectedTrace  string
		expectedSpan   string
		expectedSample bool
	}{
		{
			name:           "sampled trace",
			header:         "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
			expectedTrace:  "0af7651916cd43dd8448eb211c80319c",
			expectedSpan:   "b7ad6b7169203331",
			expectedSample: true,
		},
		{
			name:           "not sampled trace",
			header:         "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
			expectedTrace:  "0af7651916cd43dd8448eb211c80319c",
			expectedSpan:   "b7ad6b7169203331",
			expectedSample: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTraceTest(t, "traceparent", tt.header, tt.expectedTrace, tt.expectedSpan, tt.expectedSample)
		})
	}
}

func TestWithCloudTraceContext_NoHeader(t *testing.T) {
	var capturedTC *TraceContext

	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if capturedTC != nil {
		t.Error("expected no trace context when header is missing")
	}
}

func TestGetTraceContext_NilContext(t *testing.T) {
	tc := GetTraceContext(context.Background())
	if tc != nil {
		t.Error("expected nil trace context for empty context")
	}
}

func TestCloudRunRealIP(t *testing.T) {
	tests := []struct {
		name         string
		xff          string
		initialAddr  string
		expectedAddr string
	}{
		{
			name:         "single IP in XFF",
			xff:          "203.0.113.50",
			initialAddr:  "10.0.0.1:1234",
			expectedAddr: "203.0.113.50",
		},
		{
			name:         "attacker-prepended IP uses rightmost",
			xff:          "1.1.1.1, 203.0.113.50",
			initialAddr:  "10.0.0.1:1234",
			expectedAddr: "203.0.113.50",
		},
		{
			name:         "multiple spoofed IPs uses rightmost",
			xff:          "9.9.9.9, 8.8.8.8, 203.0.113.50",
			initialAddr:  "10.0.0.1:1234",
			expectedAddr: "203.0.113.50",
		},
		{
			name:         "no XFF preserves RemoteAddr",
			xff:          "",
			initialAddr:  "10.0.0.1:1234",
			expectedAddr: "10.0.0.1:1234",
		},
		{
			name:         "whitespace is trimmed",
			xff:          "1.1.1.1,  203.0.113.50 ",
			initialAddr:  "10.0.0.1:1234",
			expectedAddr: "203.0.113.50",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var capturedAddr string
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedAddr = r.RemoteAddr
			})

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.initialAddr
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			w := httptest.NewRecorder()

			CloudRunRealIP(next).ServeHTTP(w, req)

			if capturedAddr != tt.expectedAddr {
				t.Errorf("RemoteAddr = %q, want %q", capturedAddr, tt.expectedAddr)
			}
		})
	}
}

func TestHTTPRequestLogger_IncludesTraceContext(t *testing.T) {
	logger, handler := NewCaptureLogger()

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r := chi.NewRouter()
	r.Use(WithCloudTraceContext)
	r.Use(HTTPRequestLogger(logger))
	r.Get("/", nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Cloud-Trace-Context", "abc123/456;o=1")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	logs := handler.Logs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}

	log := logs[0]

	// Check trace fields are present
	traceField, ok := log.Attrs["logging.googleapis.com/trace"].(string)
	if !ok {
		t.Fatalf("expected trace to be string, got %T", log.Attrs["logging.googleapis.com/trace"])
	}
	if traceField != "abc123" {
		t.Errorf("trace = %q, want %q", traceField, "abc123")
	}

	spanID, ok := log.Attrs["logging.googleapis.com/spanId"].(string)
	if !ok {
		t.Fatalf("expected spanId to be string, got %T", log.Attrs["logging.googleapis.com/spanId"])
	}
	if spanID != "456" {
		t.Errorf("spanId = %q, want %q", spanID, "456")
	}

	sampled, ok := log.Attrs["logging.googleapis.com/trace_sampled"].(bool)
	if !ok {
		t.Fatalf("expected trace_sampled to be bool, got %T", log.Attrs["logging.googleapis.com/trace_sampled"])
	}
	if !sampled {
		t.Error("expected trace_sampled to be true")
	}
}

func mustTraceID(t *testing.T, hex string) trace.TraceID {
	t.Helper()
	id, err := trace.TraceIDFromHex(hex)
	if err != nil {
		t.Fatalf("TraceIDFromHex(%q): %v", hex, err)
	}
	return id
}

func mustSpanID(t *testing.T, hex string) trace.SpanID {
	t.Helper()
	id, err := trace.SpanIDFromHex(hex)
	if err != nil {
		t.Fatalf("SpanIDFromHex(%q): %v", hex, err)
	}
	return id
}

func TestWithCloudTraceContext_OTelSpan(t *testing.T) {
	// Create a valid span context
	traceID := mustTraceID(t, "0af7651916cd43dd8448eb211c80319c")
	spanID := mustSpanID(t, "b7ad6b7169203331")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})

	var capturedTC *TraceContext

	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	// Create request with OTel span in context
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := trace.ContextWithSpanContext(req.Context(), sc)
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if capturedTC == nil {
		t.Fatal("expected trace context to be captured from OTel span")
	}
	if capturedTC.TraceID != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("traceID = %q, want %q", capturedTC.TraceID, "0af7651916cd43dd8448eb211c80319c")
	}
	if capturedTC.SpanID != "b7ad6b7169203331" {
		t.Errorf("spanID = %q, want %q", capturedTC.SpanID, "b7ad6b7169203331")
	}
	if !capturedTC.TraceSampled {
		t.Error("expected traceSampled to be true from OTel flags")
	}
}

func TestWithCloudTraceContext_OTelPrecedence(t *testing.T) {
	// Create a valid OTel span context
	otelTraceID := mustTraceID(t, "0af7651916cd43dd8448eb211c80319c")
	otelSpanID := mustSpanID(t, "b7ad6b7169203331")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: otelTraceID,
		SpanID:  otelSpanID,
	})

	var capturedTC *TraceContext
	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Add OTel span to context
	ctx := trace.ContextWithSpanContext(req.Context(), sc)
	req = req.WithContext(ctx)
	// Add competing header
	req.Header.Set("X-Cloud-Trace-Context", "f457651916cd43dd8448eb211c80319d/1;o=1")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if capturedTC == nil {
		t.Fatal("expected trace context to be captured")
	}
	// OTel must win
	if capturedTC.TraceID != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("traceID = %q, want OTel trace %q", capturedTC.TraceID, "0af7651916cd43dd8448eb211c80319c")
	}
	if capturedTC.SpanID != "b7ad6b7169203331" {
		t.Errorf("spanID = %q, want OTel span %q", capturedTC.SpanID, "b7ad6b7169203331")
	}
	if capturedTC.TraceSampled {
		t.Error("expected traceSampled to be false from OTel context, but it was true (likely leaked from header)")
	}
}

func TestWithCloudTraceContext_OTelWithProjectID(t *testing.T) {
	t.Setenv("GOOGLE_CLOUD_PROJECT", "test-project")

	traceID := mustTraceID(t, "0af7651916cd43dd8448eb211c80319c")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8},
	})

	var capturedTC *TraceContext
	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := trace.ContextWithSpanContext(req.Context(), sc)
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	expected := "projects/test-project/traces/0af7651916cd43dd8448eb211c80319c"
	if capturedTC.TraceID != expected {
		t.Errorf("traceID (GOOGLE_CLOUD_PROJECT) = %q, want %q", capturedTC.TraceID, expected)
	}

	t.Run("GCP_PROJECT fallback", func(t *testing.T) {
		t.Setenv("GOOGLE_CLOUD_PROJECT", "")
		t.Setenv("GCP_PROJECT", "test-fallback-project")

		// Rebuild handler so projectID is captured at construction time with the new env.
		fallbackHandler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedTC = GetTraceContext(r.Context())
			w.WriteHeader(http.StatusOK)
		}))

		fallbackW := httptest.NewRecorder()
		fallbackHandler.ServeHTTP(fallbackW, req)

		wantTrace := "projects/test-fallback-project/traces/0af7651916cd43dd8448eb211c80319c"
		if capturedTC.TraceID != wantTrace {
			t.Errorf("traceID (GCP_PROJECT) = %q, want %q", capturedTC.TraceID, wantTrace)
		}
	})
}

func TestWithCloudTraceContext_InvalidOTelSpan(t *testing.T) {
	var capturedTC *TraceContext
	handler := WithCloudTraceContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTC = GetTraceContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// Invalid span (empty) in context should trigger fallback
	ctx := trace.ContextWithSpanContext(req.Context(), trace.SpanContext{})
	req = req.WithContext(ctx)
	req.Header.Set("X-Cloud-Trace-Context", "abc12345678901234567890123456789/1;o=1")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if capturedTC == nil {
		t.Fatal("expected trace context to be captured from header fallback")
	}
	if capturedTC.TraceID != "abc12345678901234567890123456789" {
		t.Errorf("traceID = %q, want header trace %q", capturedTC.TraceID, "abc12345678901234567890123456789")
	}
}
