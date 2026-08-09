# Alert: DLQ — Activity Rows (BigQuery CDC) has messages

**Symptom**: BigQuery rejected one or more activity rows and they exhausted
delivery to the `activities_live` CDC subscription. Fires as CRITICAL.

**Blast radius is bounded**: BigQuery is an archival mirror, and the
publish is best-effort — it cannot fail a webhook. PostgreSQL, which serves
every product read, is unaffected; only `activities_live` falls behind.

**First place to look**: each dead-lettered message carries a
`CloudPubSubDeadLetterSourceDeliveryErrorMessage` attribute stating exactly why
BigQuery refused it. Read that before anything else.

```bash
gcloud pubsub subscriptions pull desirelines-activity-rows-dlq-monitoring-<env> \
  --project=<project> --limit=5 \
  --format="value(message.attributes.CloudPubSubDeadLetterSourceDeliveryErrorMessage)"
```

**Likely causes** (ranked):

1. A REQUIRED column the message does not supply. A CDC delete carries only the
   primary key, so any REQUIRED column beyond `id` rejects every delete.
2. A value whose JSON type does not match its column type (e.g. a number
   arriving for a STRING column).
3. Strava sending a field shape the mapping does not normalize.

**Quick mitigations**:

- The error attribute usually names the offending column outright.
- Schema lives in `schemas/bigquery/activities_full.json`; the live table's
  relaxed derivation is in
  `terraform/modules/desirelines/bigquery_subscription.tf`.
- Kill switch: set `dispatcher_activity_row_publish_enabled = false` and
  redeploy. Nothing reads the table, so stopping is always safe.

**If still stuck**: [activity-row-publish-failing.md](activity-row-publish-failing.md)
covers the other half — rows that never left the dispatcher. This alert only
sees rows BigQuery received and refused.
