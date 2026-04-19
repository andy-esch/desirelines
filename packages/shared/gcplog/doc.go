// Package gcplog provides structured logging for Go services running on Google Cloud Platform.
//
// It wraps the standard library's [log/slog] package, configuring it to output JSON
// that integrates seamlessly with Google Cloud Logging. Log entries automatically
// appear with correct severity levels, timestamps, and source locations in the
// Cloud Console.
//
// # Basic Usage
//
// Create a logger and use it like any slog.Logger:
//
//	logger := gcplog.New()
//	logger.Info("server started", "port", 8080)
//
// Output:
//
//	{"timestamp":"2024-01-15T10:30:00Z","severity":"INFO","message":"server started","port":8080}
//
// # Log Levels
//
// The package maps slog levels to GCP severity strings:
//
//	slog.LevelDebug  -> DEBUG
//	slog.LevelInfo   -> INFO
//	slog.LevelWarn   -> WARNING
//	slog.LevelError  -> ERROR
//	gcplog.LevelCritical -> CRITICAL
//
// Use [LevelCritical] for unrecoverable errors:
//
//	logger.Log(ctx, gcplog.LevelCritical, "database connection lost", "error", err)
//
// # Configuration
//
// Use [NewWithOptions] for full control over logger behavior:
//
//	logger := gcplog.NewWithOptions(gcplog.Options{
//	    Level:     slog.LevelDebug,  // Minimum level to log
//	    Writer:    os.Stdout,        // Output destination
//	    AddSource: true,             // Include file:line in logs
//	})
//
// # HTTP Middleware
//
// The package provides Chi-compatible middleware for HTTP request logging:
//
//	r := chi.NewRouter()
//	r.Use(gcplog.WithCloudTraceContext)  // Extract trace context
//	r.Use(gcplog.HTTPRequestLogger(logger))
//
// [HTTPRequestLogger] outputs the httpRequest field in GCP's expected format,
// enabling parent-child log hierarchy in the Cloud Console. It also selects
// log levels based on response status (5xx=ERROR, 4xx=WARNING, others=INFO).
//
// [WithCloudTraceContext] extracts trace correlation IDs from incoming requests,
// preferring an active OpenTelemetry span and falling back to GCP's
// X-Cloud-Trace-Context or W3C's traceparent headers. These IDs are
// automatically included in logs, enabling correlation with Cloud Trace.
//
// # Testing
//
// The package provides utilities for testing code that uses logging:
//
//	logger, handler := gcplog.NewCaptureLogger()
//	// ... run code that logs ...
//	logs := handler.Logs()
//	if logs[0].Message != "expected" {
//	    t.Error("unexpected log message")
//	}
//
// Use [NewNoOpLogger] when you don't need to inspect logs:
//
//	logger := gcplog.NewNoOpLogger()
//
// # GCP Integration
//
// When running on Cloud Run, GKE, or Cloud Functions, JSON written to stderr
// is automatically ingested into Cloud Logging. This package ensures the JSON
// structure matches GCP's expectations:
//
//   - "severity" field with GCP severity strings
//   - "message" field for the log message
//   - "timestamp" field for log time
//   - "logging.googleapis.com/sourceLocation" for source file info
//   - "logging.googleapis.com/trace" for trace correlation
//   - "httpRequest" structured field for HTTP request logs
package gcplog
