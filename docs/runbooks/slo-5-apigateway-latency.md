# Alert: SLO 5 — apigateway latency burn

**Symptom**: the apigateway latency SLO is burning error budget — sustained slow
responses are pushing `/v1/*` p95 above 1 second. Two alerts share this runbook:

- **Fast burn (1h)** — at the current rate the 30-day budget is exhausted in
  ~2 days. Investigate now.
- **Slow burn (6h)** — sustained mild latency degradation. Lower urgency.

**Target**: 95% of `/v1/*` requests complete in < 1000ms over a rolling 30 days.
**Error budget**: 5% of requests can be slow before the budget burns.

**First place to look**:

- Console → Monitoring → Metrics Explorer → `desirelines.io/postgres/query.duration`
  by `operation`. The `list_routes` and `multi_sport_*` operations are the
  typical hot spots.
- `reading-traces.md` — the slow-pattern table maps span shapes to causes.

**Likely causes** (ranked):

1. Postgres query performance — start here; it dominates this SLO.
2. Neon cold compute — elevated session-acquire means a cold pool and a slow
   first query.
3. Cloud Run cold-start frequency, high when traffic is bursty.
4. A recent code change that added work to the request path.

**Quick mitigations**:

- Identify the dominant `operation` in the query-duration tail; that names the
  hot spot.
- Distinguish cold-start/wake spikes from a sustained plateau before optimizing
  anything.

**If still stuck**: see `postgres-query-latency.md` and
`postgres-pool-exhaustion.md` — slow queries hold connections, which makes
latency worse, which is a feedback loop worth breaking at the query. Spec:
`docs/slo.md` SLO 5.
