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
app UID. [Shared fixtures](../../schemas/test-fixtures/deletion_ownership.json)
exercise publication, the current consumer and replay.

## Trust boundary

Attributes are publisher-controlled data, not a signature or publisher identity.
[Topic IAM](../../terraform/modules/desirelines/main.tf) grants the dispatcher
publish access. Inherited project roles can also authorize publishing; privileged
deployment/replay principals are part of the trust boundary.
[The push subscription](../../terraform/modules/desirelines/pubsub_subscriptions.tf)
uses OIDC and [Cloud Run IAM](../../terraform/modules/desirelines/cloud_run.tf)
restricts invocation. The [scheduler's grant](../../terraform/modules/desirelines/readiness_probes.tf)
is limited to `/ready`; it must not authorize deletion requests. Other authorized
invokers remain trusted: push authentication does not attest the original publisher.
Before the ownership-aware consumer rollout, verify that the path restriction
is deployed without leftover unconditional scheduler grants, and review inherited
project privileges as well as resource policies.
See Google's [Pub/Sub access control](https://docs.cloud.google.com/pubsub/docs/access-control)
and [push authentication](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## Consumer behavior

The [deletion consumer](../../packages/stravapipe/src/stravapipe/cloudrun/deletion_service_app.py)
requires the V1 binding and a matching athlete event before writes. PostgreSQL
and Firestore use the captured UID. BigQuery uses the captured Strava subject.
The [Firestore adapter](../../packages/stravapipe/src/stravapipe/adapters/firestore/activity_connection.py)
checks both registry records before cleanup and rechecks them in the transaction
that deletes the tokens, user documents, admission and matching registry records.

Known conflicts and unbound events retry and can reach the DLQ. A valid captured
binding remains usable after the registry records are deleted, including when
another store failed or an ACK was lost. Each store gets a cleanup attempt and
the consumer acknowledges success only after every store succeeds.

## Deployment and rollback

Verify the V1 producer in each environment before deploying the consumer.
Review source and DLQ age, backlog and in-flight delivery evidence. Handle
unresolved messages using the [deletion DLQ runbook](../runbooks/dlq-deletion-service.md).
Replay preserves the original body and attributes.

After cutover, keep a V1 producer and roll back only to a consumer that validates
the captured binding. If no such rollback is available, fix forward and preserve
the retry/DLQ path. Keep independent enrollment gated until lifecycle work fences
same-pair reauthorization and accounts for the old consumer's in-flight execution
and access. The current stage retains full-account cleanup for Strava deauthorization.
