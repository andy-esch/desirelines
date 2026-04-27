# 04. Cloud Run Runtime Engineering

> **Goal:** Tune the few runtime knobs that actually matter on Cloud Run — connection-pool warmup, real downstream health checks, pgx-level OTel — and stop the cold-start penalty on the hot path.

## Why it matters

Cloud Run scales-to-zero. Every cold start currently does:

1. Boot the Go binary (fast).
2. Lazy-initialize the pgx pool — `MinConns = 0`.
3. Acquire a connection on the first request: TCP handshake + TLS + Postgres auth (~100–500ms).

That ~half-second hits the user every time the service has been idle. It's avoidable.

Beyond cold starts, the package's observability has a small but real gap: pgx queries don't emit OTel spans, so a slow request shows up in traces as a single span "GET /aggregates/metrics: 2.4s" with no breakdown. That makes regression hunting much harder than it needs to be.

## Current state

- `adapters/postgres/pool.go:77–81` — `MinConns` defaults to 0. No connection pre-warming.
- `cmd/apigateway/main.go:155–160` — graceful shutdown waits up to `ShutdownTimeout` for in-flight requests. DB query contexts inherit from request context (good), so cancellation works.
- `/health` endpoint exists but only returns 200 — doesn't verify the DB pool is reachable.
- pgx is **not** instrumented with OTel. `packages/shared/otel` wires HTTP/chi spans but no `pgxotel` or equivalent.
- Request ID is bridged to logs (`internal/server/router.go:58`) but not added as an attribute on DB-query spans (because there are no DB-query spans).
- `cmd/apigateway/main.go:112–119` — OTel HTTP filter skips spans for `/api/health`, but the metrics histogram still records every health check.
- No `/debug/pprof` endpoint for memory/CPU profiling in production.

## Concrete steps

### 1. Pre-warm the connection pool

In `adapters/postgres/pool.go`, default `MinConns` to `1` (configurable via `DB_POOL_MIN_CONNS`):

```go
config.MinConns = 1   // keeps one connection warm across requests
config.MaxConns = 10  // tune based on Cloud Run instance count × concurrency
```

Then, after `pgxpool.NewWithConfig`, force the warm:

```go
if err := pool.Ping(ctx); err != nil {
    return nil, fmt.Errorf("initial pool ping: %w", err)
}
```

This adds ~100ms to startup but eliminates the first-request penalty. Cloud Run startup probes already wait for `/health`, so the user never sees the boot cost.

### 2. Make `/health` actually check downstream dependencies

Today `/health` returns 200 unconditionally. Replace with two endpoints (Cloud Run convention):

- **`/health/live`** — simple 200. Liveness probe: "is the process alive?"
- **`/health/ready`** — pings pgx pool with a 1-second timeout, optionally pings Firestore. Readiness probe: "should I receive traffic?"

Wire these in Terraform as the Cloud Run startup and liveness probes. Configure Cloud Run to send traffic only after `/health/ready` returns 200.

This catches the "Postgres is down but the app says it's healthy" failure mode that wastes minutes during incident response.

### 3. Instrument pgx with OpenTelemetry

Two options:

- **[`exaring/otelpgx`](https://github.com/exaring/otelpgx)** — drop-in tracer that adds spans for every query with the SQL text (sanitized) as an attribute.
- Roll your own using pgx's `Tracer` interface — about 50 lines.

Wire it in `adapters/postgres/pool.go`:

```go
config.ConnConfig.Tracer = otelpgx.NewTracer(
    otelpgx.WithIncludeQueryParameters(false),  // PII concern
    otelpgx.WithTrimSQLInSpanName(),
)
```

Now a slow-request trace shows the HTTP span containing the SQL spans, with timings for each query. Pairs with the slow-query log from [01-repository-layer](01-repository-layer.md) step 3.

### 4. Add request ID as a span attribute on every span

Right now request IDs are bridged to logs, but spans (including the future pgx spans from step 3) don't get them. Add a chi middleware that pulls the request ID from context and calls `span.SetAttributes(attribute.String("request_id", id))`.

This closes the loop: a user reports a slow request → you find the request ID in their browser → you query Cloud Trace by `request_id` attribute → you see exactly which query was slow.

### 5. Filter health checks out of metrics histograms too

`cmd/apigateway/main.go:112–119` filters spans for `/api/health`. Apply the same filter to the metrics histogram in the OTel middleware (`packages/shared/otel/chi.go`). If Cloud Run hits `/health` once a second, that's 86k useless data points/day per instance.

### 6. Tune pool max-conns to Cloud Run concurrency

Cloud Run's default per-instance concurrency is 80 (configurable in `terraform/`). With `MaxConns = 10`, a saturated instance queues 70 requests on connection acquisition. Two paths:

- **Lower Cloud Run concurrency** to ~10 per instance → easier to reason about pool sizing, more instances at scale, slightly higher cost.
- **Raise pool max-conns** to ~20–30 → fewer instances, but watch Postgres `max_connections` (each Cloud Run instance × pool size × max instances must stay under it).

Start with concurrency=20 and `MaxConns=15`. Document the formula in `docs/runbooks/scaling.md`: `instances × MaxConns ≤ postgres.max_connections × 0.8`.

### 7. Verify in-flight queries cancel on SIGTERM

The audit confirmed query contexts inherit from request context, so cancellation should propagate. Add a regression test:

```go
func TestShutdownCancelsInFlightQueries(t *testing.T) {
    // Start server, send a request that triggers a slow query (pg_sleep),
    // SIGTERM the process, assert the query was cancelled (check pg_stat_activity
    // before and after).
}
```

Belt-and-suspenders. Once written, never breaks.

### 8. (Optional) Add gated pprof

When you actually need it (not before):

```go
if os.Getenv("ENABLE_PPROF") == "true" {
    r.Mount("/debug/pprof", chiMiddleware.Profiler())
}
```

Behind IAP/IAM-gated Cloud Run revision. Don't expose publicly.

## What to skip

- **Don't** switch from pgx to database/sql. pgx is the right choice here.
- **Don't** add Redis as a session/connection cache for Postgres. The pool is the cache.
- **Don't** tune pool numbers without measurement. Step 6 is empirical — start with the defaults above and adjust based on Cloud Monitoring data.

## References

- pgx connection pool config (`pgxpool.Config`): https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool#Config
- exaring/otelpgx: https://github.com/exaring/otelpgx
- Cloud Run probe configuration (startup, liveness, readiness): https://cloud.google.com/run/docs/configuring/healthchecks
- Cloud Run concurrency tuning: https://cloud.google.com/run/docs/about-concurrency
- chi profiler middleware: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware#Profiler
- "Connection Pool Sizing" (HikariCP wiki — applies to any pool): https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing
- OpenTelemetry semantic conventions for databases: https://opentelemetry.io/docs/specs/semconv/database/database-spans/
- Cloud Run cold-start mitigation patterns: https://cloud.google.com/run/docs/tips/general#avoid_background_activities
