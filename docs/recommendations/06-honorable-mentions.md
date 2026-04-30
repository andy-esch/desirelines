# 6. Honorable mentions — small, high-leverage cleanups

**Severity:** Low–Medium individually — but each is cheap and eliminates a
real papercut. None are top-5 material on their own; together they're a
worthwhile half-day of work.

## 6.1 Backfill concurrency

**File:** `application/backfill/service.py:154`

The backfill fetches activities one year at a time, sequentially. Strava's
API budget is generous (600 reqs / 15 min, 30,000 / day), so the wall-time
is dominated by serial latency, not rate limits.

### Recommendation

- Wrap the per-year fetch in `asyncio.gather` with an
  `asyncio.Semaphore(N)` (N=3–5 is plenty) so up to N years are in flight
  concurrently.
- Keep batch sizes the same — only the network fetch is parallelized;
  PG/BQ writes can still drain on a single producer queue.
- Multi-year backfills (e.g. `BACKFILL_YEARS=2018,2019,...,2025`) drop
  from "minutes per year, sequential" to roughly the time of the slowest
  year.

### References

- `asyncio.Semaphore` pattern:
  <https://docs.python.org/3/library/asyncio-sync.html#asyncio.Semaphore>
- Strava API rate limits:
  <https://developers.strava.com/docs/rate-limits/>

---

## 6.2 Postgres connection-pool utilization metric

**File:** `adapters/postgres/_connection.py`

The pool strategy is well-thought-out (auto-detects Neon pooler vs direct,
configurable strategy), but there's no observability on how saturated the
pool actually is at runtime. Saturation is invisible until requests start
queueing or timing out.

### Recommendation

Register OTel observable gauges that read from SQLAlchemy's `QueuePool`:

- `desirelines.io/postgres/pool.checked_out` — connections currently in
  use
- `desirelines.io/postgres/pool.checked_in` — idle connections
- `desirelines.io/postgres/pool.overflow` — overflow connections in use
- `desirelines.io/postgres/pool.size` — base pool size

Wire into the existing `setup_metrics()` flow in `shared/metrics.py`. With
these you can alert on "pool saturated >5min" before it becomes a 503.

### References

- SQLAlchemy `Pool` introspection:
  <https://docs.sqlalchemy.org/en/20/core/pooling.html#api-documentation-available-pool-implementations>
- OTel observable gauges (Python):
  <https://opentelemetry.io/docs/languages/python/instrumentation/#asynchronous-instruments>

---

## 6.3 Surface Strava API quota headers as OTel metrics

**File:** `adapters/strava/_repositories.py`

Every Strava API response includes `X-RateLimit-Usage` (e.g. `100,1000`)
and `X-RateLimit-Limit` (e.g. `600,30000`) covering the 15-minute and
daily quotas. Today these are visible in logs at best; they should be
metrics so you can alert before exhaustion.

### Recommendation

- After each successful Strava call, parse the two headers and emit two
  gauges: `strava.api.quota_15min_pct` and `strava.api.quota_daily_pct`.
- Add a Cloud Monitoring alert at 80% on either gauge. Hitting the daily
  limit means the backfill silently stalls until midnight UTC; an early
  alert lets you back off intentionally.

### References

- Strava rate-limit headers:
  <https://developers.strava.com/docs/rate-limits/>

---

## 6.4 Drop `python-dotenv` from production dependencies

**File:** `pyproject.toml:21`

`python-dotenv>=1.1.1` is listed as a top-level dependency. In production
(Cloud Run), env vars come from the runtime config — there is no `.env`
file, so the dependency is dead weight in the image.

### Recommendation

- Move `python-dotenv` to `[project.optional-dependencies]` `dev`
  alongside the rest of the local-dev tooling.
- If any code path imports it unconditionally at module top level,
  guard the import with `try/except ImportError` or move it behind a
  config check. (Cursory grep suggests it's only loaded in local-dev
  bootstrap, so this should be a one-line move.)
- Side benefit: smaller production image, slightly faster cold start.

### References

- pyproject.toml `optional-dependencies`:
  <https://packaging.python.org/en/latest/specifications/pyproject-toml/#dependencies-optional-dependencies>

---

## 6.5 Backfill duplicate-check N+1 risk

**File:** `application/backfill/service.py:278`

`uow.activities.insert(activity)` in the per-activity loop likely issues
a SELECT-then-INSERT (or a single INSERT … ON CONFLICT) per row. For
~1k activities per backfill year this is fine; for users with 10k+
activities, the round-trip count adds up.

### Recommendation

- Verify the implementation in `adapters/postgres/_repository.py`. If
  it's row-by-row, switch to a batched
  `INSERT ... ON CONFLICT (id) DO NOTHING` using SQLAlchemy's
  `insert(...).on_conflict_do_nothing()` over the whole batch (already
  chunked at BATCH_SIZE=100).
- The return value (rows actually inserted) can be obtained via
  `RETURNING id`.
- This drops PG round-trips from O(N) to O(N / BATCH_SIZE) — a 100x
  reduction at the default batch size.

### References

- SQLAlchemy `on_conflict_do_nothing` for Postgres:
  <https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#insert-on-conflict-upsert>

---

## Quick-win ordering

1. **6.4** (drop `python-dotenv`) — 5 minutes, smallest possible PR.
2. **6.2** (pool metrics) — wire into existing OTel setup, ~1 hour.
3. **6.3** (Strava quota metrics) — similar effort, immediate alerting
   value.
4. **6.5** (backfill upsert) — verify first, then a focused PG-only
   change.
5. **6.1** (backfill concurrency) — biggest behavior change of the five;
   needs a careful test for ordering assumptions.
