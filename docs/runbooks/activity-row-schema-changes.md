# Activity-row schema changes

Implementation: [schema, topic and retention settings](../../terraform/modules/desirelines/bigquery_subscription.tf)
(`google_pubsub_schema.activity_rows`, `google_pubsub_topic.activity_rows`,
`google_bigquery_table.activities_live`).
[Contract tests](../../terraform/modules/desirelines/tests/activity_rows_schema.tftest.hcl)
check schema/table identity, key, definition, deletion policy and the open BINARY
revision range.

## Policy

- Keep the deployed schema name stable. Compatible definition updates create
  revisions; retain earlier revisions so queued messages remain decodable.
- Keep the topic revision range open for older producers during rollouts.
- `prevent_destroy` protects plans; stored `deletion_policy = "PREVENT"` also
  covers removal from configuration. Neither blocks direct API/revision deletion.
- [Pub/Sub compatibility](https://docs.cloud.google.com/pubsub/docs/commit-schema-revision)
  permits adding/removing optional protobuf fields, not editing existing fields
  or adding/removing required/repeated fields. BigQuery and deployment policy
  impose separate constraints. Incompatible edits require a migration.
- Update the table in place. `prevent_destroy` blocks destructive table plans
  in dev/prod; prod also keeps stored `deletion_protection`. Removing the resource
  block removes the plan guard; neither protection blocks direct API deletion.
  The deployment repository's `.github/scripts/bigquery-schema-guard.js` checks
  the saved plan and live convergence. Rejected edits require a migration.
- Reserve a rollback slot: stop ordinary edits at 19 revisions (API limit: 20).
  Comments can consume a revision too. Quota rejection occurs at apply, not plan.

## Inspect and adopt

Use these reads before and after adoption; obtain the schema name from the
actual topic binding:

```bash
environment=dev                           # repeat with prod
project="desirelines-${environment}"
topic="desirelines-activity-rows-${environment}"
schema=$(gcloud pubsub topics describe "$topic" \
  --project="$project" --format='value(schemaSettings.schema)')
gcloud pubsub schemas describe "$schema" --project="$project" --format=json
gcloud pubsub schemas list-revisions "$schema" --project="$project" --format=json
```

Adopt in dev, then prod, before definition edits. The saved plan should change
only deletion policy in place; schema identity, definition, topic binding and
revision list must stay unchanged. Confirm `PREVENT` in applied Terraform state
privately; it is not an API property. Do not publish full plan/state files.

## Edit, roll back or retire

Edit [the source schema](../../schemas/bigquery/activities_full.json), run
`just generate-bq-proto` and `just verify-schemas`, and preserve
[field numbers](../../schemas/bigquery/cdc_field_numbers.json). Require an
in-place schema update and preserve table/topic/subscription identities.
For new fields, require a canary containing their actual values before enabling
producer writes. Schema propagation can drop fields with `drop_unknown_fields`;
a successful metadata check is insufficient. See
[Google's synchronization caveat](https://docs.cloud.google.com/pubsub/docs/create-bigquery-subscription#use_topic_schema).

Restore a previous compatible definition on the same
schema to roll back; this consumes another revision. Review older-module
reverts: hash-based names can request replacement.

**Retain revisions by default; no automatic pruning.** Before deletion, the
infrastructure owner must account for all producers/consumers, backlog, the
[configured topic/subscription/DLQ retention](../../terraform/modules/desirelines/bigquery_subscription.tf),
snapshots, replay sources and rollback needs. Elapsed retention time or the
current topic binding alone is insufficient. Deleting a revision is permanent;
a saved definition cannot restore its ID. See [Google's warning](https://docs.cloud.google.com/pubsub/docs/create-bigquery-subscription#use_topic_schema)
and the [binary DLQ replay restriction](dlq-redrive.md).

## Verify delivery and rollback

Use owner-approved disposable dev resources, separate from the live CDC path:

1. Create a schema/topic with topic retention, a compatible table and a pull
   subscription. Publish an old-definition sentinel; keep it unacknowledged and
   record its schema revision ID and pre-publication timestamp.
2. Commit a compatible optional-field revision and publish a second sentinel.
   Create the BigQuery subscription and [seek](https://docs.cloud.google.com/pubsub/docs/replay-overview)
   to that timestamp. Verify both sentinel values and retained revision IDs.
3. Restore the original definition through Terraform; verify unchanged schema
   identity, retained revisions, new delivery and CDC UPSERT/DELETE ordering.
   Record results before removing disposable resources.

Local plans do not prove delivery; record the live observations.

## Verify a description-only table edit

Before an owner-run dev deployment, record the table's creation identity,
primary key, clustering and synthetic sentinel values. Make a description-only
edit in `activities_full.json` and regenerate. Review the actual saved plan:
the table updates in place, the topic schema commits a compatible revision,
and topic/subscription identities stay unchanged. The initial module adoption
also removes the obsolete `terraform_data.activities_live_schema` state marker;
that marker owns no cloud object.

After apply, require live metadata convergence, unchanged table creation identity
and sentinel values, and CDC UPSERT/DELETE ordering. Record the observations;
a local plan does not close this checkpoint. Preserve retained schema revisions
when reverting the description.
