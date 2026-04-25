# 04. Performance: Caching, Benchmarks, Indexes

> **Goal:** Cut latency on the hot read path (cumulative metrics) and put guardrails in place before the next regression. Data-driven — measure before optimizing.

## Why it matters

Desirelines is a read-heavy visualization app. A user opens the dashboard and fetches cumulative-metric windows repeatedly for the same year and sport. Those queries use `SUM(...) OVER (PARTITION BY sport ORDER BY date)` window functions across the year's rows — recomputed from scratch on every request.

A Redis service is **already declared in `docker-compose.yml`** but nothing in `apigateway` uses it. Wiring it up is a 10–100× win on repeat views and trims Postgres load proportionally.

That said: don't cache before you measure. Step 1 below is benchmarks.

## Current state

- `docker-compose.yml` declares `redis` but `packages/apigateway` has no Redis client.
- No `Cache-Control` or `ETag` headers on aggregate endpoints — every refresh recomputes.
- No `testing.B` benchmarks in Go; no `pytest-benchmark` runs in Python.
- No load test (k6/Locust/Artillery) checked in.
- No slow-query logging (`log_min_duration_statement`) configured.
- Index strategy not documented — worth confirming `(user_id, sport_type, start_date_local)` composite index exists in `schemas/database/`.

## Concrete steps

### 1. Establish a baseline before changing anything

Add `apigateway/repository/repository_bench_test.go` with `Benchmark*` functions that run against a seeded Postgres fixture (e.g. 100k activities across 5 years, 8 sport types). Cover:

- `GetActivitiesByDateRange` for one user, one year.
- `GetCumulativeMetrics` for one user, one year, one sport.
- `GetDailySummary` for one user, one month.

Run with `go test -bench=. -benchmem` and commit a `BENCHMARKS.md` with the numbers and the machine you ran on. Without this, you can't tell if a future change made things worse.

### 2. Audit existing indexes

Read every file in `schemas/database/` and write down:

- Every index that exists.
- For each "expensive" query in `repository.go`, run `EXPLAIN ANALYZE` against the seeded fixture and confirm it uses an index scan, not a seq scan.
- The result is `schemas/database/INDEXES.md` — a one-page table of `(index → which queries use it → reasoning)`.

Likely outcome: you'll want a covering index on `(user_id, sport_type, start_date_local) INCLUDE (distance, moving_time, total_elevation_gain)` for the cumulative queries.

### 3. Add HTTP cache headers to aggregate endpoints

Cheapest possible win — TanStack Query on the client respects them for free.

For `/aggregates/*`:
- `Cache-Control: private, max-age=60, stale-while-revalidate=300`
- `ETag: <hash of (user_id, year, sport_types, last_updated_at)>`
- Handle `If-None-Match` and return `304 Not Modified` when the ETag matches.

The `last_updated_at` component invalidates correctly when a new activity lands.

### 4. Wire Redis as a read-through cache

Now that you have a baseline:

- Add `github.com/redis/go-redis/v9` to `apigateway`.
- Cache key: `aggregate:{user_id}:{year}:{sport_types_hash}:{metric}`.
- TTL: 5 minutes for aggregates, 1 minute for activity lists.
- Cache-aside pattern: check Redis, fall through to Postgres, write back.
- **On Redis failure, log a warning and fall through.** Never fail a request because cache is down.

For invalidation: when `postgres-writer` commits an activity, publish a small `cache_invalidate` message to a new Pub/Sub topic with `(user_id, year)`. `apigateway` subscribes and deletes the matching keys. Out-of-band so writes don't block on cache.

Re-run the benchmarks. Commit the new numbers in `BENCHMARKS.md`.

### 5. Turn on slow-query logging in staging

In Cloud SQL config (or your Postgres config in staging):

```
log_min_duration_statement = 200  # ms
```

Add a Cloud Logging-based metric for "slow queries per minute" and an alert if it spikes (links into [01-observability](01-observability.md)).

### 6. Add a small k6 load test

`tests/load/dashboard.js` — model the top user flow:

1. Authenticate.
2. Hit `/aggregates/metrics?year=current`.
3. Hit `/activities?limit=20`.
4. Hit `/aggregates/daily_summary?year=current`.

Run as a manual workflow_dispatch job, not on every PR. Track p50/p95/p99 over time. Post results as a PR comment when the job runs.

### 7. Graceful degradation for non-DB dependencies

Add a circuit breaker around the Firestore token-store call in `dispatcher` ([sony/gobreaker](https://github.com/sony/gobreaker)). If Firestore is slow:

- Fail fast (don't queue requests).
- Return a clear error to Strava so it retries.
- Log a structured event so the alert from [01-observability](01-observability.md) fires.

Same pattern around external Strava API calls in stravapipe — open the breaker after N consecutive failures.

## What to skip

- **Don't** cache before benchmarking. You need numbers to know if it helped.
- **Don't** introduce a CDN. Firebase Hosting already CDN-fronts the SPA assets.
- **Don't** denormalize the schema. Window functions over indexed data are fast; the cache eliminates the work entirely on repeat hits.
- **Don't** run load tests on every PR. Nightly or on-demand is right.

## References

- Cache-aside pattern (canonical reference): https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside
- `Cache-Control` directives, including `stale-while-revalidate` (RFC 5861): https://datatracker.ietf.org/doc/html/rfc5861
- HTTP conditional requests / ETag (MDN): https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
- `EXPLAIN` and index strategy ("Use the Index, Luke"): https://use-the-index-luke.com/
- PostgreSQL window function performance: https://use-the-index-luke.com/sql/partial-results/window-functions
- k6 documentation: https://grafana.com/docs/k6/latest/
- Go benchmarking + benchstat: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- go-redis: https://github.com/redis/go-redis
- sony/gobreaker (circuit breaker): https://github.com/sony/gobreaker
- "Release It!" by Michael Nygard — circuit breakers, bulkheads, timeouts. ISBN 978-1680502398.
