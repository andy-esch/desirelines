# Alert: DLQ — BQ Inserter has messages

**Symptom**: the bq-inserter dead-letter queue has ≥1 message. Activities are
failing to insert into BigQuery and have exhausted their delivery retries.
Fires as CRITICAL to email + Slack.

**First place to look**:

- Console → Pub/Sub → Subscriptions → the bq-inserter dead-letter subscription
  → **View messages** (pull without acking to inspect payloads).
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-bq-inserter"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. BigQuery schema mismatch — a field arrived that the table doesn't accept, or
   the generated proto drifted from `schemas/bigquery/activities_full.json`.
2. BigQuery permissions drift — the service account lost dataset access.
3. Malformed message payload that fails proto deserialization.
4. BigQuery quota or availability problem (rare).

**Quick mitigations**:

- Read one DLQ message and match its shape against the table schema — this
  usually names the bad field immediately.
- If a schema change caused it: fix the schema, run `just sync-schemas` and
  `just verify-schemas`, redeploy, then redrive.
- If the failure is transient (quota/availability), the messages are safe to
  replay once the dependency recovers.

**If still stuck**: cross-reference `service-5xx-server-errors.md` — bq-inserter
5xx and DLQ growth usually share a root cause. Check for a recent deploy to the
service or a recent schema migration.

> **Redrive**: there is no automated replay path today. Draining the DLQ
> currently means pulling messages and re-publishing them to the source topic by
> hand. Treat this runbook as incomplete until a documented redrive procedure
> exists.
