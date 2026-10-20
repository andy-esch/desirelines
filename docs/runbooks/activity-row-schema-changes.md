# Activity-row schema changes

The CDC topic uses a stable Pub/Sub schema identity. The name keeps its original
`693d93a6` suffix for continuity; **do not recalculate it**. Compatible definition
changes create revisions on that same object. Keep older revisions available:
Google warns that messages validated against a deleted revision cannot be
written by a BigQuery subscription using the topic schema.

This policy preserves schema metadata. It does not establish row survival,
successful CDC delivery or application compatibility. The BigQuery table's
existing full-schema replacement trigger is still present; ordinary table
schema edits remain blocked by deployment safeguards until that separate
mechanism is removed and verified.

## Adoption before schema edits

The first rollout changes only Terraform's deletion policy from `DELETE` to
`PREVENT` and installs `prevent_destroy`. The schema address, name, definition,
topic binding and open revision range stay unchanged. No import or state move
is needed. Apply this policy in dev, verify it, then promote it before making
definition changes. Do not combine protection adoption with a schema edit.

Before apply, require a saved plan with an in-place deletion-policy update and
no schema, topic, subscription or table replacement. After apply, inspect the
topic binding, definition and revision list with read-only commands:

```bash
environment=dev
project="desirelines-${environment}"
schema="desirelines-activity-rows-${environment}-693d93a6"
gcloud pubsub topics describe "desirelines-activity-rows-${environment}" \
  --project="$project" --format='json(schemaSettings)'
gcloud pubsub schemas describe "$schema" --project="$project" --format=json
gcloud pubsub schemas list-revisions "$schema" --project="$project" --format=json
```

Compare against the pre-apply snapshot. Read the applied Terraform state
privately to confirm `deletion_policy = "PREVENT"`; it is a provider-side
setting, not an API property. Never upload the full plan or state: it contains
unrelated sensitive values. The definition and revision list must remain
unchanged on this adoption rollout.

## Compatible changes and rollback

- Edit `schemas/bigquery/activities_full.json`, then run `just generate-bq-proto`
  and `just verify-schemas`. Preserve `cdc_field_numbers.json` assignments.
- Pub/Sub permits adding/removing optional protobuf fields as revisions. It
  does not permit editing existing fields or adding/removing required or
  repeated fields. BigQuery's supported edits and the deployment plan policy
  are separate contracts; an edit must satisfy all of them.
- Keep the topic's revision range open. Pinning it to the newest revision can
  exclude an older producer during rolling deployment. Retaining a revision
  does not mean every newer table definition can ingest its messages.
- Inspect the saved plan before each apply. The schema must update in place.
  Never work around an incompatible revision by changing the schema name,
  disabling protection or deleting the previous schema.
- Roll back through a reviewed source/module change that restores the previous
  compatible definition on the **same schema**. The provider commits that
  definition as another revision; it does not import or recreate a retained
  schema. Allow for propagation and verify delivery. Reverting an older module
  that still derives names from a hash can request replacement; protection
  should reject that plan. Review the plan rather than assuming a Git revert is
  operationally safe.
- A rollback also consumes a revision slot. At the limit, stop and review the
  retention decision before attempting rollback; do not delete history just to
  make the command succeed.

Before a definition edit, list revisions and leave at least one slot for a
rollback. At 19 retained revisions, stop ordinary updates for owner review.
The API's hard limit is 20; its rejection happens during commit/apply, not
Terraform planning, and is not a deployment preflight check.

Descriptions/comments can consume a revision even when the wire format stays
the same. This first adoption preserves the exact deployed definition rather
than normalizing it and introducing an unnecessary revision. Avoid cosmetic
definition edits; review revision usage before a later generator change.

## Retention and retirement

The default is **retain all revisions; no automatic deletion**. The schema stays
Terraform-managed rather than being abandoned into an unmanaged inventory.
Pub/Sub limits each schema to 20 revisions. Incompatible changes or exhaustion
require a separately reviewed migration/retirement plan; neither triggers an
automatic schema rotation or cleanup job.

The infrastructure owner must establish all of the following before proposing
deletion of a schema or revision:

1. Identify every topic, subscription, producer, rollback target, snapshot and
   supported replay source that can still reference it. A topic's current
   binding alone is insufficient.
2. Establish the last possible publication time under that revision, account
   for propagation and stopped/older producers, and inspect backlog and delivery
   evidence. This topic/subscription retain messages for 7 days; the DLQ topic
   and inspection subscription retain for 14 days. Waiting either duration alone
   does not prove a revision has no remaining consumers.
3. Resolve or explicitly retire affected DLQ messages, snapshots, exported
   messages and replay/rollback paths. The current `dlq-replay` script passes
   decoded bytes through shell command substitution, which does not preserve
   binary protobuf. Do not use it for the BINARY activity-row topic or count it
   as a verified recovery path; see [DLQ redrive](dlq-redrive.md).
4. Preserve an independently verified rollback path, record exact revision IDs
   and evidence, and obtain owner review before a destructive operation.

Keeping a copy of a definition cannot restore a deleted revision ID or make
messages validated under that ID deliverable again. Deletion is permanent.

Terraform's `prevent_destroy` rejects planned schema destruction while the block
exists. The stored `deletion_policy = "PREVENT"` additionally rejects destruction
after removal from configuration. These guards do not prevent direct API
deletion, deleting individual revisions or all effects of a provider rollback.
There is deliberately no ordinary deployment cleanup command in this runbook.

## Isolated dev delivery proof

Run this in a separately named, disposable dev topic/schema/table/subscription,
with owner approval for cloud writes. Do not mutate the live CDC path or its
retention settings to manufacture a backlog. Record resource IDs, revision IDs,
publish times and bounded query evidence; remove only the disposable resources
after the proof and after accounting for their queued messages.

1. Create the initial schema, a separate topic with 7-day topic retention, a
   compatible BigQuery table and a pull subscription before publishing a
   uniquely identified protobuf CDC sentinel. Retain the message unacknowledged;
   record its `googclient_schemarevisionid` without relying on a row count.
2. Commit a compatible optional-field revision to the same schema. Confirm the
   original revision still exists and a fresh sentinel uses the newer revision.
3. Create the isolated BigQuery subscription and seek it to the recorded
   pre-publication timestamp while the topic retains those messages. Verify the
   original sentinel arrives with its original values, then the newer sentinel.
   Allow bounded propagation time; investigate DLQ/backlog on timeout.
4. Restore the original compatible definition through the Terraform update
   path, verify the schema identity stayed unchanged and all prior revisions
   remain, then verify new publication and delivery. This consumes a revision.
5. Verify CDC UPSERT/DELETE and sequence ordering on isolated sentinel IDs.
   Record actual results. Mocked plans and local serialization tests do not
   satisfy this delivery/rollback checkpoint.

This proof remains an owner-run checkpoint after adoption; this runbook is a
procedure, not a claim that the experiment has passed.

## References

- [BigQuery subscription schema-retention warning](https://docs.cloud.google.com/pubsub/docs/create-bigquery-subscription#use_topic_schema)
- [Pub/Sub revision compatibility and limits](https://docs.cloud.google.com/pubsub/docs/commit-schema-revision)
- [Topic revision-range semantics](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.topics#SchemaSettings)
- [Topic retention and seek](https://docs.cloud.google.com/pubsub/docs/replay-overview)
- [Pinned Google provider schema implementation](https://github.com/hashicorp/terraform-provider-google/blob/v8.2.0/google/services/pubsub/resource_pubsub_schema.go)
