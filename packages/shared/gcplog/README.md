# gcplog

Structured logging for Go services on Google Cloud Platform.

This package wraps `log/slog` with configuration for GCP Cloud Logging integration. It's used by both `dispatcher` and `apigateway` services in this monorepo.

## Why This Package?

When running on Cloud Run, GKE, or Cloud Functions, JSON logs written to stderr are automatically ingested into Cloud Logging. However, GCP expects specific field names and formats to enable features like:

- **Severity filtering** - Filter by DEBUG, INFO, WARNING, ERROR, CRITICAL
- **Log hierarchy** - Group request logs with their parent HTTP request
- **Trace correlation** - Link logs to Cloud Trace spans
- **Source navigation** - Click through to source code locations

This package handles all the field mapping so you can use standard `slog` patterns.

## Quick Start

```go
import "github.com/andy-esch/desirelines/packages/shared/gcplog"

func main() {
    logger := gcplog.New()
    logger.Info("server started", "port", 8080)
}
```

## Middleware Setup

For HTTP services, use both middleware in this order:

```go
r := chi.NewRouter()
r.Use(gcplog.WithCloudTraceContext)    // 1. Extract trace headers
r.Use(gcplog.HTTPRequestLogger(logger)) // 2. Log requests
```

**Order matters**: `WithCloudTraceContext` must come first so trace IDs are available when `HTTPRequestLogger` runs.

## Cloud Console Features

### Log Hierarchy

The `HTTPRequestLogger` middleware outputs an `httpRequest` field that GCP recognizes. In the Cloud Console, you'll see request logs with expandable child logs grouped underneath.

### Trace Correlation

When requests include trace headers (`X-Cloud-Trace-Context` or `traceparent`), logs automatically include trace IDs. In Cloud Trace, you can view all logs associated with a specific trace.

### Severity-Based Log Levels

The middleware automatically selects severity based on response status:

- `5xx` responses → ERROR
- `4xx` responses → WARNING
- All others → INFO

## API Reference

Run `go doc` for full API documentation:

```bash
go doc github.com/andy-esch/desirelines/packages/shared/gcplog
```

Or see the [doc.go](doc.go) file directly.

## Testing

The package provides test utilities that won't clutter test output:

```go
// Capture logs for assertions
logger, handler := gcplog.NewCaptureLogger()
// ... run code ...
logs := handler.Logs()

// Or discard logs entirely
logger := gcplog.NewNoOpLogger()
```

See [example_test.go](example_test.go) for runnable examples.
