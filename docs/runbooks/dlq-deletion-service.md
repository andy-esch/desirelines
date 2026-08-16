# Alert: DLQ — Deletion Service has messages

**Symptom**: the deletion-service dead-letter queue has ≥1 message. A user-data
deletion (triggered by a Strava deauthorization) has exhausted its delivery
retries. Fires as CRITICAL to email + Slack.

This is the most compliance-sensitive DLQ in the system — the deletion service
implements the Strava API Agreement §5.4 requirement to delete a deauthorized
user's data. A message here means that deletion did **not** complete.

**First place to look**:

- Each dead-lettered message carries a
  `CloudPubSubDeadLetterSourceDeliveryErrorMessage` attribute naming why
  delivery failed, and the payload names the athlete whose deletion failed:

  ```bash
  gcloud pubsub subscriptions pull desirelines-deletion-service-dlq-monitoring-<env> \
    --project=<project> --limit=5 \
    --format="value(message.attributes.CloudPubSubDeadLetterSourceDeliveryErrorMessage,message.data)"
  ```

  Pulling without `--auto-ack` leaves the messages in place. Acking is what
  silences the alert, so inspect before you drain — and this is the
  compliance-sensitive DLQ, so record what you found.

- Or Console → Pub/Sub → Subscriptions →
  `desirelines-deletion-service-dlq-monitoring-<env>` → **View messages**.
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-deletion-service"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. A dependency was unavailable when the delete ran — Neon (Postgres) suspended,
   BigQuery permissions drift, or Firestore unreachable.
2. A partial delete: one store succeeded and another failed, so the message
   retried and eventually exhausted attempts.
3. Malformed or unexpected payload shape from the deauth publisher.

**Quick mitigations**:

- Read one DLQ message to identify the affected athlete and the failing store,
  then confirm that dependency is healthy.
- The deletion touches PostgreSQL, BigQuery, and Firestore (not Firebase Auth) —
  check the one named in the service logs.
- Once the dependency recovers, the message can be replayed to complete the
  deletion. Do not simply drain it — the deletion still owes completion.

**If still stuck**: this is a compliance obligation, not a routine failure —
escalate rather than let it sit. Cross-reference `python-readiness-failing.md`
(the deletion service may also be failing readiness) and the DLQ runbooks for
the sibling services if a shared dependency (Neon) is the root cause.

**Redrive**: once the failing store is healthy, replay with `just dlq-replay
deletion-service <env>` (dry run) then `--execute`. See
[Redriving a DLQ](dlq-redrive.md) — it carries the compliance-verification step
for this service.
