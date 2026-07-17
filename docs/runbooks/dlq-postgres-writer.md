# Alert: DLQ — PostgreSQL Writer has messages

**Symptom**: the postgres-writer dead-letter queue has ≥1 message. Activities
are failing to write to Postgres and have exhausted their delivery retries.
Fires as CRITICAL to email + Slack.

**First place to look**:

- Console → Pub/Sub → Subscriptions → the postgres-writer dead-letter
  subscription → **View messages**.
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-postgres-writer"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. Neon unavailable or compute suspended — connection refused / timeout.
2. Schema mismatch after a migration that the writer hasn't caught up to.
3. Connection pool exhaustion under load — see `postgres-pool-exhaustion.md`.
4. Constraint violation (NOT NULL, FK) from an unexpected payload shape.

**Quick mitigations**:

- Check Neon first: is the compute suspended or the project over quota?
- Read one DLQ message; the failure shape in the service logs (schema vs
  connection vs constraint) tells you which of the causes above applies.
- If it was a transient Neon outage, messages replay cleanly once it recovers.

**If still stuck**: check `postgres-query-latency.md` (slow queries hold
connections and cause write timeouts) and `slo-2-webhook-ingest-success.md` —
SLO 2 measures exactly this DLQ, so it is probably burning too.

> **Redrive**: there is no automated replay path today. Draining the DLQ
> currently means pulling messages and re-publishing them to the source topic by
> hand. Treat this runbook as incomplete until a documented redrive procedure
> exists.
