# Activity-row schema changes

[Implementation](../../terraform/modules/desirelines/bigquery_subscription.tf) ·
[Contract tests](../../terraform/modules/desirelines/tests/activity_rows_schema.tftest.hcl) ·
[Provider lifecycle tests](../../scripts/ci/activity_table_lifecycle.py).
Run both test suites without cloud credentials: `just tf-test`.

## Policy

- Keep schema names stable, retain revisions for queued messages, and leave the
  topic revision range open for older producers.
- `prevent_destroy` protects plans; stored `deletion_policy = "PREVENT"` also
  covers removal from configuration. Neither blocks direct API/revision deletion.
- [Pub/Sub compatibility](https://docs.cloud.google.com/pubsub/docs/commit-schema-revision)
  permits adding/removing optional protobuf fields, not editing existing fields
  or adding/removing required/repeated fields. The
  [table allowlist](../../schemas/bigquery/README.md#changing-the-live-schema)
  imposes separate constraints; rejected edits require a migration.
- Update the table in place. `prevent_destroy` blocks destructive table plans
  in dev/prod; prod also keeps stored `deletion_protection`. Removing the resource
  block removes the plan guard; neither protection blocks direct API deletion.
  The deployment repository's `.github/scripts/bigquery-schema-guard.js` checks
  the saved plan and live convergence.
- Reserve a rollback slot: stop ordinary edits at 19 revisions (API limit: 20).
  Comments can consume a revision too. Quota rejection occurs at apply, not plan.

## Inspect and adopt

Inspect revisions before and after changes, using the actual topic binding:

```bash
environment=dev                           # repeat with prod
project="desirelines-${environment}"
topic="desirelines-activity-rows-${environment}"
schema=$(gcloud pubsub topics describe "$topic" \
  --project="$project" --format='value(schemaSettings.schema)')
gcloud pubsub schemas describe "$schema" --project="$project" --format=json
gcloud pubsub schemas list-revisions "$schema" --project="$project" --format=json
```

For initial retention adoption (dev, then prod), only the stored deletion policy
should change; preserve schema identity, definition, binding and revisions.
Verify `PREVENT` privately in applied state, not the API. Do not publish plan/state files.

## Edit, roll back or retire

Edit [the source schema](../../schemas/bigquery/activities_full.json), run
`just generate-bq-proto` and `just verify-schemas`, and preserve
[field numbers](../../schemas/bigquery/cdc_field_numbers.json) and resource identities.
Before enabling new fields, require a canary proving their values reach BigQuery:
[schema propagation can drop fields](https://docs.cloud.google.com/pubsub/docs/create-bigquery-subscription#use_topic_schema)
with `drop_unknown_fields`; metadata convergence alone is insufficient.

Rollback restores a compatible definition under the same schema name and consumes
another revision. Check older modules before reverting: hash-based Pub/Sub names
can request replacement; the old table trigger restores replacement on later edits.
Keep table protection and the saved-plan guard when rolling back.

**No automatic revision pruning.** Before permanent deletion, the owner must
account for producers/consumers, backlog,
[topic/subscription/DLQ retention](../../terraform/modules/desirelines/bigquery_subscription.tf),
snapshots, replay and rollback. Age or the current binding alone is insufficient;
a saved definition cannot restore a deleted revision ID. Respect the
[binary DLQ replay restriction](dlq-redrive.md).

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

## Verify a description-only table edit

1. Adopt the module in dev without editing the source schema. The table stays
   unchanged; removing `terraform_data.activities_live_schema` affects only state.
2. Record table creation identity, key, clustering and synthetic sentinel values.
   Edit a description in `activities_full.json` and regenerate. Require an in-place
   table update, a compatible topic-schema revision and stable topic/subscription identities.
3. After apply, require live metadata convergence, unchanged creation identity,
   key, clustering and sentinel values, plus CDC UPSERT/DELETE ordering. Preserve
   retained revisions when reverting the description.

Record live observations for both checkpoints; local plans do not close them.
