# Deauthorization ownership handoff

The [dispatcher](../../packages/dispatcher/adapters/http/handler.go) resolves the
server-owned UID/Strava subject pair, confirms grant revocation, publishes to the
dedicated deauthorization topic, then best-effort deletes the captured owner's
tokens. A publish failure retains tokens so redelivery can confirm and retry.

[`PublishDeauth`](../../packages/dispatcher/adapters/pubsub/publisher.go) adds:

| Pub/Sub attribute | Value |
|---|---|
| `deletion_owner_version` | `1` |
| `deletion_owner_uid` | Captured app UID; opaque, even when numeric |
| `deletion_owner_provider` | `strava` |
| `deletion_owner_subject` | Captured canonical Strava athlete ID |

The subject must match the athlete event's `owner_id`. The JSON body retains
provider IDs and the existing envelope. Public webhook fields cannot supply the
app UID. Publication, consumption and replay share a
[contract fixture](../../schemas/test-fixtures/deletion_ownership.json).

## Trust boundary

[Topic IAM](../../terraform/modules/desirelines/main.tf) grants the dispatcher
publish access. Inherited project grants and replay operators are trusted too.
[Push OIDC](../../terraform/modules/desirelines/pubsub_subscriptions.tf)
authenticates delivery to the [internal Cloud Run service](../../terraform/modules/desirelines/cloud_run.tf).
Publisher identity is outside that OIDC assertion. Review resource and inherited
grants before rollout, including the
[`/ready`-only scheduler grant](../../terraform/modules/desirelines/readiness_probes.tf).

## Consumer behavior

The [deletion consumer](../../packages/stravapipe/src/stravapipe/cloudrun/deletion_service_app.py)
requires the V1 binding and a matching athlete event before writes. PostgreSQL
and Firestore use the captured UID. BigQuery uses the captured Strava subject.
The [Firestore adapter](../../packages/stravapipe/src/stravapipe/adapters/firestore/activity_connection.py)
checks for conflicts before cleanup. If both registry records exist, they must
agree. The transaction rechecks ownership before deleting tokens, user
documents, admission and matching registry records.

Known conflicts and unbound events retry and can reach the DLQ. A valid captured
binding remains usable after the registry records are deleted, including when
another store failed or an ACK was lost. Each store gets a cleanup attempt and
the consumer acknowledges success only after every store succeeds.

## Deployment and rollback

Verify the V1 producer in each environment before deploying the consumer. Review
source and DLQ age, backlog and in-flight delivery evidence. Triage unresolved
messages within the existing 48-hour cleanup window.
See the [deletion DLQ runbook](../runbooks/dlq-deletion-service.md).

After cutover, keep a V1 producer and roll back only to a consumer that validates
the captured binding. If no such rollback is available, fix forward and preserve
the retry/DLQ path. Keep independent enrollment gated until lifecycle work fences
same-pair reauthorization and accounts for the old consumer's in-flight execution
and access. Strava deauthorization still triggers full-account cleanup.
