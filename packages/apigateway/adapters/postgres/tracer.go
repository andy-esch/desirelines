package postgres

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// queryCtxKey is unexported to prevent context-key collisions.
type queryCtxKey struct{}

// queryCtxValue stashes the per-query data we need at TraceQueryEnd.
// We capture the SQL text and arg count at start time because pgx's
// TraceQueryEndData does not include them — only the command tag and
// any error. Bind arg *values* are intentionally not captured to avoid
// PII leaks and unbounded log cardinality.
type queryCtxValue struct {
	start    time.Time
	sql      string
	argCount int
}

// slowQueryTracer implements pgx.QueryTracer. It logs a WARN line for any
// query whose duration meets or exceeds threshold. Bind arg *values* are
// intentionally not logged — only arg count — to avoid PII leaks and
// unbounded log cardinality. If you need arg values during an incident,
// fall back to OTel spans (already emitted by the repository methods).
type slowQueryTracer struct {
	logger    *slog.Logger
	threshold time.Duration
}

// Compile-time interface check.
var _ pgx.QueryTracer = (*slowQueryTracer)(nil)

// newSlowQueryTracer constructs a slowQueryTracer that logs to the given
// logger when a query's duration meets or exceeds threshold.
func newSlowQueryTracer(logger *slog.Logger, threshold time.Duration) *slowQueryTracer {
	return &slowQueryTracer{logger: logger, threshold: threshold}
}

// TraceQueryStart stashes the start time, templated SQL, and arg count on
// the returned context for TraceQueryEnd to consume.
func (t *slowQueryTracer) TraceQueryStart(
	ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData,
) context.Context {
	return context.WithValue(ctx, queryCtxKey{}, queryCtxValue{
		start:    time.Now(),
		sql:      data.SQL,
		argCount: len(data.Args),
	})
}

// TraceQueryEnd logs at WARN if the elapsed time meets or exceeds threshold.
// Slog auto-injects trace context (logging.googleapis.com/trace) via the
// shared handler, so no manual correlation plumbing is needed.
func (t *slowQueryTracer) TraceQueryEnd(
	ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData,
) {
	v, ok := ctx.Value(queryCtxKey{}).(queryCtxValue)
	if !ok {
		return // start time missing; should never happen
	}
	elapsed := time.Since(v.start)
	if elapsed < t.threshold {
		return
	}
	attrs := []any{
		"sql", v.sql,
		"arg_count", v.argCount,
		"duration_ms", elapsed.Milliseconds(),
	}
	if data.Err != nil {
		attrs = append(attrs, "error", data.Err.Error())
	}
	t.logger.WarnContext(ctx, "slow postgres query", attrs...)
}
