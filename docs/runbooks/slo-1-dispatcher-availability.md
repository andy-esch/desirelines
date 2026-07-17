# Alert: SLO 1 — dispatcher availability burn

**Symptom**: the dispatcher availability SLO is burning error budget. Two alerts
share this runbook:

- **Fast burn (1h)** — at the current rate the 30-day budget is exhausted in
  ~2 days. Investigate now.
- **Slow burn (6h)** — sustained mild degradation; at 6× normal rate the budget
  depletes in ~5 days. Lower urgency; investigate in the next working session.

**Target**: 99% of `POST /webhook` requests return < 500 over a rolling 30 days.
**Error budget**: roughly 1.5–6 sustained 5xx per month at typical volume.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-dispatcher"
  httpRequest.status>=500
  ```

- `reading-traces.md` for trace inspection.

**Likely causes** (ranked):

1. A recent dispatcher deploy.
2. Strava API connectivity — token refresh failures, 401 chains.
3. Firestore read failures — the allowlist check or token store fail closed
   with 500. See `webhook-owner-check-error.md`.
4. Pub/Sub publish failures downstream of dispatcher work.

**Quick mitigations**:

- Check the deploy history first; roll back if the burn starts at a revision.
- Walk the dependency chain: Strava → Firestore → Pub/Sub. Each has its own
  runbook.

**If still stuck**: see `webhook-events-absent.md` for the related "no events
arriving at all" story — a dispatcher returning 500 and a dispatcher receiving
nothing look different but are often adjacent. Spec: `docs/slo.md` SLO 1.
