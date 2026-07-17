# Alert: Postgres connection pool near exhaustion

**Symptom**: apigateway's Postgres connection pool has ≥4 connections in use
(default max is 5 via `DB_POOL_MAX_CONNS`). Fires as HIGH to email + Slack.
Sustained exhaustion causes request queueing and rising query-duration tails.

Threshold context: fires at 80% of the pool. The 7-day observed max was 1
connection in use — capacity is heavily over-provisioned for current scale, and
this alert exists to catch the moment that changes.

**First place to look**:

- Console → Monitoring → Metrics Explorer → `desirelines.io/postgres/query.duration`
  P99, grouped by the `operation` label. Slow queries hold connections.
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  ```

**Likely causes** (ranked):

1. Slow queries holding connections — a missing index or lock contention.
2. Genuine traffic growth against a pool sized for single-user scale.
3. A connection leak introduced by a recent code change.

**Quick mitigations**:

- Check query P99 first. If queries are slow, fix the query — raising the pool
  just moves the problem.
- If traffic genuinely grew, raise `DB_POOL_MAX_CONNS` (Neon's pooled endpoint
  can handle considerably more).
- If no query is slow and traffic is normal, suspect a leak in recent changes.

**If still stuck**: see `postgres-query-latency.md`. Pool exhaustion and query
latency are usually the same incident viewed from two angles.
