package postgres

import (
	"context"
	"log/slog"
	"time"

	sharedotel "github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
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

// acquireSpanCtxKey carries the per-acquire span-end callback from
// TraceAcquireStart to TraceAcquireEnd via the context that pgxpool
// threads between them.
type acquireSpanCtxKey struct{}

// pgxTracer combines slow-query logging with OTel `postgres.session.acquire`
// span emission. Implementing both pgx.QueryTracer and pgxpool.AcquireTracer
// on a single struct lets pgxpool wire them up via type assertion (see
// pgxpool/pool.go: it checks `ConnConfig.Tracer.(AcquireTracer)`).
//
// Bind arg *values* are intentionally not logged or stamped on spans —
// only arg count — to avoid PII leaks and unbounded log/span cardinality.
type pgxTracer struct {
	logger        *slog.Logger
	slowThreshold time.Duration // 0 disables slow-query WARN lines.
	tracer        trace.Tracer  // never nil — falls back to no-op in constructor.
}

// Compile-time interface checks.
var (
	_ pgx.QueryTracer       = (*pgxTracer)(nil)
	_ pgxpool.AcquireTracer = (*pgxTracer)(nil)
)

// newPgxTracer constructs a pgxTracer.
//
// slowThreshold > 0 enables slow-query WARN logs at the given threshold.
// tracer != nil enables `postgres.session.acquire` OTel spans on every
// connection-pool checkout. Either or both can be enabled independently;
// passing nil for tracer falls back to a no-op tracer (spans no-op).
func newPgxTracer(logger *slog.Logger, slowThreshold time.Duration, tracer trace.Tracer) *pgxTracer {
	if tracer == nil {
		tracer = tracenoop.NewTracerProvider().Tracer("")
	}
	return &pgxTracer{logger: logger, slowThreshold: slowThreshold, tracer: tracer}
}

// TraceQueryStart stashes the start time, templated SQL, and arg count on
// the returned context for TraceQueryEnd to consume.
func (t *pgxTracer) TraceQueryStart(
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
func (t *pgxTracer) TraceQueryEnd(
	ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData,
) {
	if t.slowThreshold == 0 {
		return
	}
	v, ok := ctx.Value(queryCtxKey{}).(queryCtxValue)
	if !ok {
		return // start time missing; should never happen
	}
	elapsed := time.Since(v.start)
	if elapsed < t.slowThreshold {
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

// TraceAcquireStart opens a `postgres.session.acquire` span. Stashes the
// span-end callback on the context so TraceAcquireEnd can close it.
//
// On a warm pool with an idle connection this is sub-millisecond; under
// contention or when pgxpool needs to open a new connection (Neon cold
// compute included), this span captures the wait. Mirrors the
// `postgres.session.acquire` span emitted by stravapipe's
// SqlAlchemyUnitOfWork on the writer side.
func (t *pgxTracer) TraceAcquireStart(
	ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData,
) context.Context {
	ctx, spanDone := sharedotel.StartSpan(ctx, t.tracer, "postgres.session.acquire",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
	)
	return context.WithValue(ctx, acquireSpanCtxKey{}, spanDone)
}

// TraceAcquireEnd closes the acquire span. The error (if any) is passed
// to spanDone so the span records ERROR status on connection failures.
func (t *pgxTracer) TraceAcquireEnd(
	ctx context.Context, _ *pgxpool.Pool, data pgxpool.TraceAcquireEndData,
) {
	spanDone, ok := ctx.Value(acquireSpanCtxKey{}).(func(error))
	if !ok {
		return // start callback missing; should never happen
	}
	spanDone(data.Err)
}
