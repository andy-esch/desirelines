# Alert: DLQ — PostgreSQL Writer has messages

**Symptom**: the postgres-writer dead-letter queue has ≥1 message. Activities
are failing to write to Postgres and have exhausted their delivery retries.
Fires as CRITICAL to email + Slack.

**Store divergence**: while this DLQ has traffic, PostgreSQL — the source of
truth — is missing events that reached BigQuery, so BigQuery is temporarily
ahead. Unlike the activity-rows (BigQuery CDC) DLQ, this **is**
product-affecting: reads come from PostgreSQL. Repair PG and reconcile via the backfill job. See
[PostgreSQL ↔ BigQuery Consistency](../architecture/postgres-bigquery-consistency.md).

**First place to look**:

- Each dead-lettered message carries a
  `CloudPubSubDeadLetterSourceDeliveryErrorMessage` attribute naming why
  delivery failed. Read it before anything else:

  ```bash
  gcloud pubsub subscriptions pull desirelines-postgres-writer-dlq-monitoring-<env> \
    --project=<project> --limit=5 \
    --format="value(message.attributes.CloudPubSubDeadLetterSourceDeliveryErrorMessage)"
  ```

  Pulling without `--auto-ack` leaves the messages in place. Acking is what
  silences the alert, so inspect before you drain — the attribute is the only
  record of the cause.

- Or Console → Pub/Sub → Subscriptions →
  `desirelines-postgres-writer-dlq-monitoring-<env>` → **View messages**.
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
