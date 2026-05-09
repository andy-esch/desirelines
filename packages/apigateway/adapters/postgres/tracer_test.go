package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// newRecordingLogger returns a slog.Logger that writes JSON records to the
// returned buffer at debug level (so all WARN/INFO records are captured).
// Tests can decode the buffer to assert on log fields.
func newRecordingLogger(t *testing.T) (*slog.Logger, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	handler := slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(handler), buf
}

// decodeRecords parses the buffer's newline-delimited JSON log records.
func decodeRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimRight(buf.String(), "\n"), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("failed to decode log record %q: %v", line, err)
		}
		records = append(records, rec)
	}
	return records
}

func TestSlowQueryTracer_BelowThreshold_DoesNotLog(t *testing.T) {
	logger, buf := newRecordingLogger(t)
	tracer := newPgxTracer(logger, 500*time.Millisecond, nil)

	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{
		SQL:  "SELECT 1",
		Args: []any{42},
	})
	// End immediately — well under the 500ms threshold.
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})

	if got := buf.String(); got != "" {
		t.Errorf("expected no log output for fast query, got %q", got)
	}
}

func TestSlowQueryTracer_AboveThreshold_LogsWarn(t *testing.T) {
	logger, buf := newRecordingLogger(t)
	// Threshold of 1ms keeps the test fast while still exercising the path.
	tracer := newPgxTracer(logger, 1*time.Millisecond, nil)

	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{
		SQL:  "SELECT slow_query($1, $2)",
		Args: []any{"sport", 2026},
	})
	// Sleep long enough to exceed threshold reliably across CI noise.
	time.Sleep(10 * time.Millisecond)
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})

	records := decodeRecords(t, buf)
	if len(records) != 1 {
		t.Fatalf("expected 1 log record, got %d (buf=%q)", len(records), buf.String())
	}
	rec := records[0]

	if rec["level"] != "WARN" {
		t.Errorf("level = %v, want WARN", rec["level"])
	}
	if rec["msg"] != "slow postgres query" {
		t.Errorf("msg = %v, want %q", rec["msg"], "slow postgres query")
	}
	if rec["sql"] != "SELECT slow_query($1, $2)" {
		t.Errorf("sql = %v, want %q", rec["sql"], "SELECT slow_query($1, $2)")
	}
	// JSON numeric decoding yields float64.
	if argCount, ok := rec["arg_count"].(float64); !ok || argCount != 2 {
		t.Errorf("arg_count = %v, want 2", rec["arg_count"])
	}
	durationMs, ok := rec["duration_ms"].(float64)
	if !ok {
		t.Fatalf("duration_ms missing or wrong type: %v", rec["duration_ms"])
	}
	if durationMs < 1 {
		t.Errorf("duration_ms = %v, want >= 1", durationMs)
	}
	// Successful queries should not include an error field.
	if _, has := rec["error"]; has {
		t.Errorf("unexpected error field in success log: %v", rec["error"])
	}
}

func TestSlowQueryTracer_ArgCountMatchesInput(t *testing.T) {
	logger, buf := newRecordingLogger(t)
	tracer := newPgxTracer(logger, 1*time.Millisecond, nil)

	args := []any{"a", "b", "c", "d", "e"}
	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{
		SQL:  "SELECT $1, $2, $3, $4, $5",
		Args: args,
	})
	time.Sleep(5 * time.Millisecond)
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})

	records := decodeRecords(t, buf)
	if len(records) != 1 {
		t.Fatalf("expected 1 log record, got %d", len(records))
	}
	if got, ok := records[0]["arg_count"].(float64); !ok || int(got) != len(args) {
		t.Errorf("arg_count = %v, want %d", records[0]["arg_count"], len(args))
	}
}

func TestSlowQueryTracer_LogsErrorFieldOnFailure(t *testing.T) {
	logger, buf := newRecordingLogger(t)
	tracer := newPgxTracer(logger, 1*time.Millisecond, nil)

	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{
		SQL:  "SELECT bad_column",
		Args: nil,
	})
	time.Sleep(5 * time.Millisecond)
	queryErr := errors.New("column \"bad_column\" does not exist")
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: queryErr})

	records := decodeRecords(t, buf)
	if len(records) != 1 {
		t.Fatalf("expected 1 log record, got %d", len(records))
	}
	rec := records[0]

	if rec["level"] != "WARN" {
		t.Errorf("level = %v, want WARN", rec["level"])
	}
	if got, ok := rec["error"].(string); !ok || got != queryErr.Error() {
		t.Errorf("error = %v, want %q", rec["error"], queryErr.Error())
	}
	// Nil args should report as 0.
	if argCount, ok := rec["arg_count"].(float64); !ok || argCount != 0 {
		t.Errorf("arg_count = %v, want 0", rec["arg_count"])
	}
}

func TestSlowQueryTracer_NoLogWhenContextMissing(t *testing.T) {
	// Defensive: TraceQueryEnd must not panic and must not log if it is
	// called with a context that never went through TraceQueryStart.
	logger, buf := newRecordingLogger(t)
	tracer := newPgxTracer(logger, 1*time.Millisecond, nil)

	tracer.TraceQueryEnd(context.Background(), nil, pgx.TraceQueryEndData{})

	if got := buf.String(); got != "" {
		t.Errorf("expected no log output without start context, got %q", got)
	}
}

func TestPgxTracer_AcquireSpanEmitted(t *testing.T) {
	// Verify TraceAcquireStart/End emit a `postgres.session.acquire` span
	// with the expected name and db.* attributes. This is the apigateway's
	// equivalent of stravapipe's SqlAlchemyUnitOfWork session-acquire span;
	// regressions here would silently drop the apigateway's pool-checkout
	// signal in Cloud Trace.
	logger, _ := newRecordingLogger(t)
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	pt := newPgxTracer(logger, 0, tp.Tracer("test"))

	ctx := pt.TraceAcquireStart(context.Background(), nil, pgxpool.TraceAcquireStartData{})
	pt.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{})

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	span := ended[0]
	if span.Name() != "postgres.session.acquire" {
		t.Errorf("span name = %q, want %q", span.Name(), "postgres.session.acquire")
	}

	wantAttrs := map[string]string{"db.system": dbSystem, "db.name": dbName}
	for _, attr := range span.Attributes() {
		want, ok := wantAttrs[string(attr.Key)]
		if !ok {
			continue
		}
		if got := attr.Value.AsString(); got != want {
			t.Errorf("attr %q = %q, want %q", attr.Key, got, want)
		}
		delete(wantAttrs, string(attr.Key))
	}
	if len(wantAttrs) != 0 {
		t.Errorf("missing required attributes: %v", wantAttrs)
	}
}

func TestPgxTracer_AcquireSpanRecordsError(t *testing.T) {
	// Failed pool acquires (e.g. timeout, network) must surface as ERROR
	// status on the span so Cloud Trace's status facet finds them.
	logger, _ := newRecordingLogger(t)
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	pt := newPgxTracer(logger, 0, tp.Tracer("test"))

	ctx := pt.TraceAcquireStart(context.Background(), nil, pgxpool.TraceAcquireStartData{})
	acquireErr := errors.New("connection refused")
	pt.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{Err: acquireErr})

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if got := ended[0].Status().Code.String(); got != "Error" {
		t.Errorf("span status = %q, want %q", got, "Error")
	}
}

func TestPgxTracer_AcquireEndWithoutStart_NoPanic(t *testing.T) {
	// Defensive: if pgxpool ever calls TraceAcquireEnd with a context that
	// never went through TraceAcquireStart, the tracer must no-op silently
	// rather than panic. Currently never happens but cheap to guarantee.
	logger, _ := newRecordingLogger(t)
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	pt := newPgxTracer(logger, 0, tp.Tracer("test"))

	pt.TraceAcquireEnd(context.Background(), nil, pgxpool.TraceAcquireEndData{})

	if ended := sr.Ended(); len(ended) != 0 {
		t.Errorf("expected 0 ended spans, got %d", len(ended))
	}
}

func TestPgxTracer_NilTracer_NoOp(t *testing.T) {
	// nil tracer should fall back to a no-op tracer; acquire methods must
	// still operate cleanly without emitting spans.
	logger, _ := newRecordingLogger(t)
	pt := newPgxTracer(logger, 0, nil)

	ctx := pt.TraceAcquireStart(context.Background(), nil, pgxpool.TraceAcquireStartData{})
	pt.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{})
	// No assertions — just verifying no panic.
}
