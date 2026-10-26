# Activity connection registry

The registry separates a Strava account from the Firebase UID that owns it.
Bootstrap preserves existing Firebase UIDs, credential paths and activity ownership.

## Contract

Go's [activityconnection](../../packages/shared/activityconnection/) package and
Python's [activity_connection](../../packages/stravapipe/src/stravapipe/adapters/firestore/activity_connection.py)
share the [contract fixture](../../schemas/test-fixtures/activity_connection.json).
The same record is stored at both paths:

- `provider_accounts/strava:{subject}`: one UID per canonical positive decimal Strava ID.
- `users/{uid}/connections/strava`: one active Strava account per UID.

Scope names use lowercase ASCII `[a-z0-9_:]+`; duplicate scopes are invalid.
The [shared scope cases](../../schemas/test-fixtures/activity_connection_scopes.json)
exercise both validators. Fields are `schema_version`, `uid`, `provider`, `subject`,
`scopes`, `status`, `provenance` and `bootstrap_id`. UIDs are opaque. Records contain no credentials;
client SDK access is denied. Both ownership directions are claimed atomically;
conflicts, incomplete pairs and inactive connections fail closed. OAuth exchanges
and Firebase Auth calls stay outside retryable Firestore transactions.

Legacy bootstrap uses provenance `legacy_uid`, preserves UID = original athlete
ID and records an operation ID. Scopes start empty because legacy token/profile
fields are not trusted evidence. Bootstrap never copies or rotates tokens.
Future OAuth connection work supplies verified scopes independently.

## Ownership readers

Go's [Store.Resolve](../../packages/shared/activityconnection/store.go) and
Python's [ConnectionResolver.resolve](../../packages/stravapipe/src/stravapipe/adapters/firestore/activity_connection.py) return only an
active, matching pair. Keep the returned UID separate from the provider subject:
UIDs identify app data and credentials; subjects identify Strava accounts.

An absent or inactive lookup returns `ErrNotFound` / `ConnectionNotFoundError`.
Malformed or inconsistent pairs return `ErrConflict` / `ConnectionConflictError`;
SDK and network failures propagate separately.

For a caller-owned credential transaction, use Go's `ResolveInTransaction` or
Python's `resolve_in_transaction` so ownership and credentials share a snapshot.
Finish reads before writes, as required by [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).
Bind a refresh write to the UID/subject pair that supplied its credentials, and
keep external OAuth/Auth calls outside retryable callbacks.

These readers do not establish app admission, verify a provider grant or prove
rollout readiness. Callers enforce those boundaries separately. Adopting readers
in runtime sign-in or ingestion requires the bootstrap, verification and sealing
steps below; deploying the reader package alone does not activate routing.

## Inventory and review

The [operator command](../../packages/apigateway/cmd/connection-registry/main.go)
requires explicit project and database flags. It uses Application Default
Credentials and reads `POSTGRES_CONNECTION_STRING` without printing it. Its
Postgres inventory runs in a read-only transaction and requires a role that can
see every activity owner; RLS-filtered snapshots and multi-host failover URLs
are refused. The manifest binds the non-secret Postgres host/port/database as well
as Firebase's target. Keep reports/manifests in a private operator workspace; they contain UIDs, never tokens or profile payloads.

```sh
just connection-registry --mode inventory --project PROJECT --database DATABASE > inventory.json
```

Inventory cross-checks Firebase UID/admission document IDs, provider metadata,
Firestore user paths and persisted PostgreSQL owners. Client-writable legacy
profile fields can identify a mismatch, never establish a mapping. Eligible users
must have both legacy profile and credential document paths; inventory checks
credential names without reading their payloads. A numeric UID alone is
insufficient: the owner must attest that approved UIDs were issued by the legacy
server flow. Unknown provenance and conflicts stop apply.

Create a reviewed manifest; do not blindly turn inventory output into approval:

```json
{
  "project": "PROJECT",
  "database": "DATABASE",
  "postgres_target": "DATABASE_HOST:5432/DATABASE_NAME",
  "operation_id": "legacy-bootstrap-1",
  "reviewed_legacy_uids": true,
  "uids": ["123"],
  "excluded": {"456": "allowlist-only; not previously enrolled, keep admission frozen"}
}
```

Every eligible candidate must be included. Blocking mismatches/orphans cannot
be overridden by exclusions; fix their cause and regenerate inventory. Exclusions
only disposition non-admitted identities such as allowlist-only entries. They receive no
mapping and cannot newly sign in while admissions are frozen. Reusing a manifest
refuses newly appeared or changed owners; it is not a stale snapshot override.

## Owner-controlled rollout

These commands are for a reviewed maintenance window, not automatic deployment.
No live bootstrap is performed by tests or by merging this code.

The [deploy script](../../scripts/ops/deploy/deploy-web.sh), invoked with
`just deploy-web ENV` from the reviewed checkout, publishes Hosting and rules.
GitOps web deploys publish Hosting only. Confirm that [firebase.json](../../firebase.json)
targets the database being bootstrapped. Before freezing, compare the published
source with [firestore.rules](../../firestore.rules) in the target database's
[Firestore Rules tab](https://docs.cloud.google.com/firestore/native/docs/security/get-started#use_the_google_cloud_console)
(Cloud console → database → Security). Record the project, database, deployed
commit and published ruleset in the rollout checkpoint. Stop on a mismatch;
emulator tests and a successful Hosting deployment do not verify hosted rules.

1. Deploy registry-aware legacy deletion and the gateway's transactional admission
   check. Deploy and verify credential-denial rules before any bootstrap writes.
2. Freeze admissions, let in-flight legacy sign-ins settle, then refresh inventory
   and review the manifest. The freeze initially denies unmapped legacy sign-ins;
   existing sessions continue. Applied, still-admitted mappings permit sign-in.
3. Apply and verify. Existing mappings are never overwritten, and partial runs
   resume using the same operation ID. Verify again before any resolver rollout.
4. Seal bootstrap rollback **before** deploying ownership resolvers. Preserve
   mappings after that boundary; do not restore old ownership-inference binaries
   once independent UIDs are admitted. Independent admission remains disabled
   until its separate readiness checkpoint.

```sh
just connection-registry --mode freeze --project PROJECT --database DATABASE --confirm-project PROJECT
just connection-registry --mode apply --project PROJECT --database DATABASE --manifest reviewed.json --confirm-project PROJECT
just connection-registry --mode verify --project PROJECT --database DATABASE --manifest reviewed.json
just connection-registry --mode seal --project PROJECT --database DATABASE --confirm-project PROJECT
```

The control document `identity_migration/legacy_admissions` contains `frozen` and
`rollback_allowed` booleans. Missing control preserves current sign-in; malformed
control fails closed. Freeze cannot reopen sealed rollback. The gateway checks
admission/control/mappings in the same transaction as credentials, and legacy
deletion atomically removes admission, registry records and user documents so
concurrent login/bootstrap cannot recreate Firestore ownership or tokens. Do not
manually re-add revoked admissions during the freeze; that bypasses the migration
policy when an old mapping remains.

## Rollback

Before sealing, rollback removes only unchanged record pairs created by that
operation. Existing credentials/config/ownership are not migrated or removed.
**Rolled-back users cannot start a new sign-in while admissions remain frozen.**
Existing sessions continue. The supported exit is to correct the underlying issue,
refresh inventory/review, re-apply the reviewed manifest and verify. Keep the freeze
and hardened rules throughout; rollback is temporary removal of bootstrap records,
not an exit from the migration. No thaw is supported during this migration.
While registry data or the freeze remains active, backend rollback must retain
registry-aware deletion and admission checks. Older backends that ignore those
controls are not supported rollback targets.

```sh
just connection-registry --mode rollback --project PROJECT --database DATABASE --manifest reviewed.json --confirm-project PROJECT
```

Apply, verify and rollback emit per-UID JSON progress; preserve stdout on failure.
Apply receipts record committed claims; only the final verification summary confirms
all owners resolved successfully. Errors name the failed UID. Rollback reports `removed`,
`already_absent` or `retained_other_operation`; it fails if only other operations'
records remain. Retrying an already-absent rollback succeeds. A partial failure
preserves earlier receipts, so review them before retrying or re-applying.

For a frontend rollback, use the supported `deploy-web.sh ENV --hosting-only`
route, retaining hardened rules. Do not run an older combined Hosting/rules
script. Once resolvers depend on mappings, fix forward and preserve the registry;
the bootstrap rollback command refuses after sealing.
