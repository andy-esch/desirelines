# Activity ownership fence rollout

[V0018](../../schemas/database/migrations/V0018__prepare_owned_activity_deletion_fences.sql)
prepares `activity_deletion_fences`. It does not change current ingestion or
populate the table. Existing `deleted_activities`, activities and mappings remain
untouched; historical tombstones have no trustworthy owner to backfill.

The new primary key is `(source, external_id, user_id, external_owner_id)`:
`user_id` is the app UID and `external_owner_id` is the provider subject. A future
writer must check both the historical unattributed fence and its exact owned
fence, preserving event-time and backfill-watermark ordering. There is no FK to
an activity or mapping because a fence must outlive their deletion. Full-account
cleanup must purge the new UID-bound markers before writes activate.

## Supported sequence

The migration overrides default privileges: runtime writers can SELECT the new
table, but INSERT/UPDATE/DELETE remain disabled. Deploying a compatible image
alone cannot populate it. This avoids a permanent runtime flag or a second legacy
write implementation.

[identity-rollout.json](../../scripts/ci/identity-rollout.json) declares two
protocol values, validated by [the release producer](../../scripts/ci/image_release.py):

| Release | `writer_protocol` | `required_writer_protocol` | Fence writes |
|---|---:|---:|---|
| Preparation | 0 | 0 | Existing legacy table only |
| Compatible writer | 1 | 0 | New-table writes retry until activation |
| Activation migration | 1 | 1 | New-table DML granted after readiness gate |

The writer capability comes from each authenticated Python image's build source,
including retained images. The migration requirement comes from the candidate
application source. Older version-1 declarations mean protocol 0.

1. Merge the GitOps guard support before this version-2 source declaration.
   Apply V0018 with the current writer; no activity-row rewrite or new fence is
   needed. Retain legacy tombstones.
2. Deploy compatible Python code (writer, deletion service and backfill) in
   both environments before activation, checking the original owner tuple and
   both fence stores.
   Production must receive this intermediate release before dev activates. Its activity and full-account DELETEs retry while the
   table is read-only. Plan a short activation window before that code reaches
   production, including supported replay if retries reach the DLQ. Do not leave
   cleanup queued across the existing 48-hour duty.
3. Verify all traffic-serving Python service revisions and backfill templates. Drain
   older requests, executions and workflows; never rerun a pre-guard workflow.
   Close the local saved-plan recovery binding gap before activation.
   Publish/review the separate activity-writer compatibility checkpoint through
   the GitOps rollout procedure. It binds protocol 1 to the verified PostgreSQL
   target and a drainage receipt, without modifying the bootstrap seal.
4. A separately reviewed activation migration grants table DML and raises
   `required_writer_protocol` to 1. Preflight and every apply attempt require the
   reviewed live checkpoint and a compatible selected Python image before
   Flyway. Verify queued cleanup and normal create/delete behavior afterward.

After the floor is published, protocol-0 writer images are unsupported rollback
or recovery targets. Fix forward or select another compatible image. Retain the
live checkpoint and its reviewed GitOps receipt; removing either fails current
hosted activation/recovery checks. Independent enrollment stays separately gated.

The [migration tests](../../packages/stravapipe/tests/integration/test_owned_fence_preparation.py)
exercise preservation, actual role permissions and independent owner tuples in
an isolated historical database. They also require protocol 1 whenever the latest
schema/callback grants fence DML, preventing an undeclared activation. GitOps policy tests cover retained images,
checkpoint substitution, API failures and repeated apply attempts. These checks
do not themselves inspect or drain the live fleet; the checkpoint records the
owner's verified operational evidence.
