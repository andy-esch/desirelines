# Activity ownership fences

[V0018](../../schemas/database/migrations/V0018__prepare_owned_activity_deletion_fences.sql)
adds an empty `activity_deletion_fences` table. Runtime roles can SELECT; DML is
withheld until a separate activation migration. Activities, mappings and historical
`deleted_activities` remain unchanged. Historical fences have no reliable owner
to backfill.

The key is `(source, external_id, user_id, external_owner_id)`: app UID and provider
subject are separate. Future writers must check both the historical fence and
their exact owned tuple, preserving event-time/backfill-watermark ordering. No
activity/mapping FK is present because fences must survive their deletion.
Full-account cleanup must purge UID-bound fences before activation.

[identity-rollout.json](../../scripts/ci/identity-rollout.json), validated by the
[release producer](../../scripts/ci/image_release.py), declares these phases:

| Release | `writer_protocol` | `required_writer_protocol` |
|---|---:|---:|
| Preparation | 0 | 0 |
| Compatible Python code; fence writes retry until activation | 1 | 0 |
| Activation migration grants fence DML | 1 | 1 |

The deployment guard reads capability from each authenticated Python image's
build source and migration requirements from the candidate source. Older v1
declarations mean protocol 0. Merge guard support before this v2 declaration.

Deploy compatible writer, deletion service and backfill in **both environments**
before activating dev, so production can promote the intermediate release.
Schedule a short window: activity/full-account DELETEs retry while DML is withheld;
include DLQ replay within the existing 48-hour cleanup duty. Close the local
saved-plan recovery gap and hold release submissions during drainage/checkpoint
publication. Verify live revisions/templates and drain older requests,
executions and **all queued/running older backend releases**, including guarded
jobs past their last check. Never rerun a pre-guard workflow.

Before granting DML, publish the owner-reviewed writer floor and its GitOps receipt
bound to the verified PostgreSQL target. Hosted preflight and every apply attempt
reject incompatible Python images thereafter; retain both artifacts and use
compatible rollback targets. The guard checks metadata, not the live fleet.
Independent enrollment remains separately gated; the bootstrap seal is unchanged.

[Migration tests](../../packages/stravapipe/tests/integration/test_owned_fence_preparation.py)
cover preservation, real role privileges, independent owner tuples and the
requirement that granting DML declares protocol 1.
