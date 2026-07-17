# Alert: SLO 2 — webhook ingest success burn

**Symptom**: the webhook ingest success SLO is burning error budget. Activity
events are landing in the postgres-writer DLQ. Two alerts share this runbook:

- **Fast burn (1h)** — at the current rate the 30-day budget is exhausted in
  ~2 days. Investigate now.
- **Slow burn (6h)** — sustained mild DLQ activity. Lower urgency.

**Target**: 99% of activity-events messages ack successfully (do not hit the
DLQ) over a rolling 30 days.
**Error budget**: roughly 1.5–6 lost events per month at typical volume.

**Distinct from SLO 1**: the dispatcher can be 100% healthy while this fires —
the failure is downstream of publish. Do not start at the dispatcher.

**First place to look**:

- `dlq-postgres-writer.md` — the DLQ alert is almost certainly firing too, and
  its messages name the concrete failure.
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-postgres-writer"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. postgres-writer failures — schema mismatch, connection refused, timeout.
2. A recent postgres-writer deploy or DB schema migration.
3. Neon availability or quota.
4. Pub/Sub delivery health for the postgres-writer subscription.

**Quick mitigations**:

- Read a DLQ message first — the failure shape routes the whole triage.
- If Neon was briefly out, the messages replay cleanly once it recovers.

**If still stuck**: see `postgres-pool-exhaustion.md` and
`postgres-query-latency.md`. Spec: `docs/slo.md` SLO 2.
