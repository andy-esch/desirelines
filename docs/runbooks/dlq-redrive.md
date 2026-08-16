# Technique: Redriving a DLQ

Replaying dead-lettered messages back onto the topic they came from, so the
service that failed them gets another delivery.

`scripts/ops/dlq-replay.sh` does the pull → republish → ack cycle. Dry run by
default; `--execute` prompts for confirmation:

```bash
just dlq-replay postgres-writer prod            # show what would replay
just dlq-replay postgres-writer prod --execute  # replay it
```

Services: `postgres-writer`, `deletion-service`, `activity-rows`.

## Before you replay

**Fix the failure first.** A message that still fails burns its five delivery
attempts and lands straight back in the DLQ. Confirm the service is healthy —
the DLQ runbook's Cloud Logging filter is the fastest check — before redriving.

**Read the failure reason before draining.** Acking is what silences the alert,
and `CloudPubSubDeadLetterSourceDeliveryErrorMessage` is the only record of why
delivery failed. The runbooks show how to pull it without acking.

**Check the topic's fan-out.** Republishing re-delivers to *every* subscription
on the source topic, not just the one that dead-lettered. Today each source
topic has exactly one subscription, so a replay only re-triggers the intended
service — confirm that still holds:

```bash
gcloud pubsub subscriptions list --format='value(name,topic)'
```

The script drops `CloudPubSubDeadLetter*` and `dispatcher_received_at_unix_ms`
(a days-old stamp would land as [SLO 3](../slo.md) pipeline latency), keeps
`correlation_id` and `traceparent`, and adds `replayed_from_dlq=true`. Publish
precedes ack, so a failed publish leaves the message in the DLQ.

## After

Duplicate and out-of-order replays are safe for the activity path — handlers are
idempotent and `last_event_time` fencing discards stale events regardless of
arrival order.

```bash
gcloud logging read 'resource.labels.service_name="desirelines-<service>"' \
  --limit=20 --freshness=10m
```

For `deletion-service`, verify the deletion actually completed across
PostgreSQL, BigQuery, and Firestore — it is a compliance obligation, not a
routine write.

If the underlying data is recoverable from Strava, the `desirelines-backfill`
job is the alternative to message surgery: heavier, but self-healing and it
needs no DLQ contents.
