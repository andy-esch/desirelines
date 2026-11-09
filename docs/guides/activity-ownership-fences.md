# Activity ownership fences

[V0018](../../schemas/database/migrations/V0018__prepare_owned_activity_deletion_fences.sql)
adds an empty `activity_deletion_fences` table. Runtime roles can SELECT; DML is
withheld until a separate activation migration. Activities, mappings and historical
`deleted_activities` remain unchanged. Historical fences have no reliable owner
to backfill.

The key is `(source, external_id, user_id, external_owner_id)`: app UID and provider
subject are separate. The [Python repository](../../packages/stravapipe/src/stravapipe/adapters/postgres/_repository.py)
checks both the historical fence and its exact owned tuple, preserving
event-time/backfill-watermark ordering. No
activity/mapping FK is present because fences must survive their deletion.
Full-account cleanup purges UID-bound fences in the same SQL transaction.
Before activation, runtime DELETEs fail and retry because fence DML is withheld;
activity and mapping deletions roll back together.

[identity-rollout.json](../../scripts/ci/identity-rollout.json), validated by the
[release producer](../../scripts/ci/image_release.py), declares these phases:

| Release | `writer_protocol` | `required_writer_protocol` |
|---|---:|---:|
| Preparation | 0 | 0 |
| Compatible Python code; fence writes retry until activation | 1 | 0 |
| Activation migration grants fence DML | 1 | 1 |

The deployment guard reads capability from each authenticated Python image's
build source and migration requirements from the candidate source. Older v1
declarations mean protocol 0. The compatible Python release declares `1/0`; it does not grant fence DML.

Deploy compatible writer, deletion service and backfill in **both environments**
before activating dev, so production can promote the intermediate release.
First deploy the writer's read-only registry IAM grant and `FIRESTORE_DATABASE`
setting from the [Terraform module](../../terraform/modules/desirelines/main.tf).
The grant is limited to that database, not individual documents. Verify read-only
transactions via SDK/REST as the writer identity in each database. Module rollbacks must
retain this access while resolver-dependent writer images are deployed.
Module pins advance separately from app images; co-shipping the grant with its
first consumer does not establish readiness.
Schedule a short window: activity/full-account DELETEs retry while DML is withheld;
include DLQ replay within the existing 48-hour cleanup duty. Use the guarded local
saved-plan recovery path and hold release submissions during drainage/checkpoint
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
