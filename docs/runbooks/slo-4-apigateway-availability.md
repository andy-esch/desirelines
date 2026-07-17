# Alert: SLO 4 — apigateway availability burn

**Symptom**: the apigateway availability SLO is burning error budget. Two alerts
share this runbook:

- **Fast burn (1h)** — at the current rate the 30-day budget is exhausted in
  ~2 days. Investigate now.
- **Slow burn (6h)** — sustained mild degradation; budget depletes in ~5 days.
  Lower urgency; investigate in the next working session.

**Target**: 99.5% of `/v1/*` requests return < 500 over a rolling 30 days.
**Error budget**: roughly 37–150 5xx responses per month at typical volume.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  httpRequest.status>=500
  ```

- `reading-traces.md` for trace inspection.

**Likely causes** (ranked):

1. A recent apigateway deploy.
2. Cloud Run instance health — cold-start spikes, OOM kills.
3. Database connectivity — see `postgres-pool-exhaustion.md` and Neon compute
   state.
4. Firebase auth verification failures (tracked by a separate auth metric).

**Quick mitigations**:

- Check the deploy history first; roll back if the burn starts at a revision.
- Check whether `apigateway-readiness-failing.md` is also firing — that isolates
  a dependency problem from a code problem.

**If still stuck**: 5xx driven by slow dependencies burns SLO 5 (latency) at the
same time. If both are burning, treat it as one incident. Spec: `docs/slo.md`
SLO 4.
