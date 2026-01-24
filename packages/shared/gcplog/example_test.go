package gcplog_test

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/go-chi/chi/v5"
)

func ExampleNew() {
	// Create a logger with default settings (INFO level, writes to stderr)
	logger := gcplog.New()

	// Use like any slog.Logger
	logger.Info("application started", "version", "1.0.0")
	logger.Warn("deprecated endpoint called", "endpoint", "/v1/old")
	logger.Error("request failed", "error", "connection timeout")
}

func ExampleNewWithOptions() {
	var buf bytes.Buffer

	// Create a logger with custom options
	logger := gcplog.NewWithOptions(gcplog.Options{
		Level:     slog.LevelDebug, // Log everything including debug
		Writer:    &buf,            // Write to buffer instead of stderr
		AddSource: true,            // Include file:line in output
	})

	logger.Debug("detailed trace info", "step", 1)

	// Output includes logging.googleapis.com/sourceLocation field
	fmt.Println(strings.Contains(buf.String(), "logging.googleapis.com/sourceLocation"))
	// Output: true
}

func ExampleNewWithLevel() {
	// Create a logger that only logs warnings and above
	logger := gcplog.NewWithLevel(slog.LevelWarn)

	// These won't appear in output
	logger.Debug("ignored")
	logger.Info("also ignored")

	// These will appear
	logger.Warn("this appears")
	logger.Error("this also appears")
}

func ExampleLevelCritical() {
	var buf bytes.Buffer
	logger := gcplog.NewWithOptions(gcplog.Options{Writer: &buf})

	// Use CRITICAL for unrecoverable errors
	logger.Log(context.TODO(), gcplog.LevelCritical, "database connection pool exhausted")

	fmt.Println(strings.Contains(buf.String(), `"severity":"CRITICAL"`))
	// Output: true
}

func ExampleHTTPRequestLogger() {
	logger := gcplog.New()

	r := chi.NewRouter()

	// Add the request logger middleware
	r.Use(gcplog.HTTPRequestLogger(logger))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	// Each request will be logged with httpRequest field in GCP format:
	// {
	//   "severity": "INFO",
	//   "message": "HTTP Request",
	//   "httpRequest": {
	//     "requestMethod": "GET",
	//     "requestUrl": "/health",
	//     "status": 200,
	//     "latency": "0.001234567s",
	//     ...
	//   }
	// }
}

func ExampleWithCloudTraceContext() {
	logger := gcplog.New()

	r := chi.NewRouter()

	// Extract trace context from incoming requests (add before HTTPRequestLogger)
	r.Use(gcplog.WithCloudTraceContext)
	r.Use(gcplog.HTTPRequestLogger(logger))

	r.Get("/api/users", func(w http.ResponseWriter, r *http.Request) {
		// Access trace context in handlers if needed
		if tc := gcplog.GetTraceContext(r.Context()); tc != nil {
			// tc.TraceID, tc.SpanID, tc.TraceSampled available
			_ = tc
		}
		_, _ = w.Write([]byte("[]"))
	})

	// Requests with X-Cloud-Trace-Context or traceparent headers will have
	// trace correlation fields in logs, enabling Cloud Trace integration
}

func ExampleNewCaptureLogger() {
	// Create a logger that captures logs for testing
	logger, handler := gcplog.NewCaptureLogger()

	// Run code that logs
	logger.Info("user logged in", "user_id", "123")
	logger.Warn("rate limit approaching", "remaining", 10)

	// Inspect captured logs
	logs := handler.Logs()
	fmt.Printf("Captured %d logs\n", len(logs))
	fmt.Printf("First log message: %s\n", logs[0].Message)
	fmt.Printf("First log level: %s\n", logs[0].Level)
	// Output:
	// Captured 2 logs
	// First log message: user logged in
	// First log level: INFO
}

func ExampleNewNoOpLogger() {
	// Create a logger that discards all output (useful in tests)
	logger := gcplog.NewNoOpLogger()

	// These produce no output
	logger.Info("this goes nowhere")
	logger.Error("neither does this")

	fmt.Println("No output produced")
	// Output: No output produced
}

func ExampleGetTraceContext() {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get trace context from request (set by WithCloudTraceContext middleware)
		tc := gcplog.GetTraceContext(r.Context())
		if tc != nil {
			// Use trace info for custom logging or propagation
			fmt.Printf("Trace: %s, Span: %s\n", tc.TraceID, tc.SpanID)
		}
		w.WriteHeader(http.StatusOK)
	})

	// Wrap with trace context middleware
	wrapped := gcplog.WithCloudTraceContext(handler)

	// Simulate request with GCP trace header
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Cloud-Trace-Context", "abc123/456;o=1")
	w := httptest.NewRecorder()

	wrapped.ServeHTTP(w, req)
	// Output: Trace: abc123, Span: 456
}
