# Technique: Redriving a DLQ

Replaying dead-lettered messages back onto the topic they came from, so the
service that failed them gets another delivery.

[The replay command](../../scripts/ops/dlq-replay.sh) runs the
[Python implementation](../../scripts/ops/dlq_replay.py)'s pull → republish → ack
cycle. It requires Python 3, authenticated `gcloud`, and the matching active
project (`desirelines-dev` or `desirelines-prod`). Dry run by default;
`--execute` requires interactive confirmation:

```bash
just dlq-replay postgres-writer prod            # show what would replay
just dlq-replay postgres-writer prod --execute  # replay it
just dlq-replay activity-rows dev              # inspect BINARY CDC messages
```

Supported services are `postgres-writer`, `deletion-service`, and
`activity-rows`. The command discovers the topic encoding and carries data as
base64 in the [Pub/Sub publish API](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.topics/publish),
preserving JSON and BINARY bytes, including NULs and trailing newlines. A dry run
pulls without publishing or acknowledging, then releases its leases; its count
is an inspection result, not proof that the backlog is empty.

## Before you replay

**Fix the failure first.** Check the service logs and confirm recovery before
redriving. A persistent failure can return to the DLQ.

**Find the failure before draining.** Use consumer logs for push failures and
broker diagnostics for export subscriptions. The delivery error attribute is
specific to export subscriptions. See [Pub/Sub dead-letter attributes](https://docs.cloud.google.com/pubsub/docs/dead-letter-topics#track_delivery_attempts).
For account cleanup, follow the [deletion DLQ runbook](dlq-deletion-service.md)
before executing a replay.

**Check the topic's fan-out.** Republishing re-delivers to *every* subscription
on the source topic, not just the one that dead-lettered. Confirm the current
subscriptions and agree on the replay window:

```bash
gcloud pubsub subscriptions list --format='value(name,topic)'
```

The script drops `CloudPubSubDeadLetter*`, old `googclient_schema*` validation
metadata, delivery-attempt metadata, and `dispatcher_received_at_unix_ms`
(a days-old stamp would land as [SLO 3](../slo.md) pipeline latency), keeps
application attributes and ordering keys, and adds `replayed_from_dlq=true`.
Pub/Sub validates each republish against the destination's current allowed
schema revisions. Preserve compatible revisions; removing old validation
attributes does not convert an incompatible payload.

Only confirmed publishes are acknowledged. On failure the command stops,
acknowledges earlier successful publishes, and releases unacknowledged leases.
A timeout or failed acknowledgement can cause a duplicate on retry; delivery
remains at least once. If lease release fails, those messages become available
when their leases expire.

## After

Check backlog and delivery errors after execution; an empty pull does not prove
the queue is drained. Activity event handlers fence stale events with
`last_event_time`. BINARY CDC replay preserves `_CHANGE_SEQUENCE_NUMBER` in the
payload, allowing BigQuery to ignore stale changes. See the
[activity-row runbook](dlq-activity-rows.md) for delivery failures.

```bash
gcloud logging read 'resource.labels.service_name="desirelines-<service>"' \
  --limit=20 --freshness=10m
```

For activity ingestion failures, `desirelines-backfill` can recover data still
available from Strava.
