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

## Deployment sequence

1. Deploy this additive producer in dev and prod. The
   [current deletion consumer](../../packages/stravapipe/src/stravapipe/cloudrun/deletion_service_app.py)
   still uses the legacy numeric identity and ignores these attributes.
   Independent enrollment remains disabled.
2. Before deploying ownership-aware cleanup, verify producer revisions and
   inspect the source subscription and DLQ for older messages. Account for
   in-flight deliveries and replay; a quiet queue sample alone is insufficient.
3. The later consumer must validate the complete versioned binding before any
   destructive work, retain the captured UID for app data and subject for the
   archive, and conditionally purge Firestore without removing a replacement
   owner's records. Missing or conflicting evidence must remain retryable/DLQ,
   without guessing a UID or silently acknowledging unfinished cleanup.

[`dlq_replay.py`](../../scripts/ops/dlq_replay.py) preserves the ownership attributes
and body. Never rewrite them using today's registry. An older producer can still
feed the current consumer, but rollback after consumer migration must preserve
the binding or quarantine unbound messages. Full-account deletion remains the
current policy; provider-only disconnect and same-pair reauthorization/ABA
protection require the later lifecycle design.
