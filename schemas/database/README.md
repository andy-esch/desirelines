# Database Migrations

Flyway-based database migrations for Desirelines PostgreSQL (Neon-hosted).

For setting up a database from scratch read [Database Setup Playbook](../../docs/guides/database-setup.md), a step-by-step guide to setting up a new database for this project.

## Local Development

```bash
# Start frontend stack (includes postgres + flyway + api-gateway)
just start-frontend

# Or start backend stack (includes postgres + flyway + full pipeline)
just start-backend

# Connect to database
just db-connect-local

# View flyway logs
docker compose logs flyway
```

**Volume behavior**: The database uses an anonymous volume that resets on every `docker compose down`. This ensures a clean slate and prevents stale migration issues. Each startup runs init scripts and migrations fresh.

**Troubleshooting**:

- If migrations fail with "role does not exist", the Flyway `beforeMigrate` callback should self-heal by creating missing role groups.
- If Flyway fails to connect, it will retry for up to 30 seconds (`FLYWAY_CONNECT_RETRIES=30`).
- For a full reset: `just restart-frontend` or `just restart-backend`

## Production Deployment

Dev and prod deployments run Flyway before updating service and job images.
The `just` recipes below support manual status checks and migration recovery.
Credentials are stored as connection strings in Secret Manager and fetched
and parsed automatically by the deployment action and local scripts.

The recipes are parameterized: `just db-migrate <env> [action]` (action: `migrate`
(default), `info`, `clean`) and `just db-connect <env> [role]` (role: `admin`
(default), `apigateway`, `writer`).

```bash
# Dev environment
just db-migrate dev info     # Check status (dry-run)
just db-migrate dev          # Run migrations
just db-connect dev writer   # Connect (read/write)
just db-connect dev admin    # Connect (admin)

# Prod environment (requires "yes" confirmation)
just db-migrate prod info    # Check status
just db-migrate prod         # Run migrations
just db-connect prod writer  # Connect (read/write)
just db-connect prod admin   # Connect (admin)
```

**First-time setup**: See [Database Setup Playbook](../../docs/guides/database-setup.md) for complete steps including pre-migration setup (schemas, extensions, roles) that must be done as `neondb_owner` before Flyway runs.

### Activity-ID allocation rollout

The allocation transition is complete in the V0015 schema. The following sweep
steps apply only before V0015, while `rekey_adopted_activities()` still exists;
never run them against the final schema. New ingestion and local seeds allocate
from the identity sequence and retain external IDs only in the mapping.

New writers allocate desirelines activity IDs from the identity sequence and
keep Strava IDs in `activity_external_ids`. V0013 sweeps rows ingested with
their Strava ID after the initial V0012 re-key. The deployment runs migrations
before updating service and job images, so the V0013 count alone does not
prove that all old writers have stopped adopting IDs.

1. Record V0013's `Re-keyed ... adopted activity ID stragglers` count from the
   migration log.
2. Finish the `postgres-writer` and `backfill` image rollout. Wait for in-flight
   requests on old revisions and any old backfill executions to finish (or stop
   those executions) before checking for remaining adopted IDs.
3. Connect with `just db-connect dev apigateway` (use `prod` for production)
   and count remaining adopted IDs:

   ```sql
   SELECT count(*) AS adopted
   FROM desirelines.activities a
   JOIN desirelines.activity_external_ids m ON m.activity_id = a.id
   WHERE m.source = 'strava' AND m.external_id = a.id::text;
   ```

4. If the count is nonzero, connect as `admin` and run the idempotent sweep:

   ```sql
   BEGIN;
   SET LOCAL ROLE desirelines_ddl_grp;
   SET LOCAL lock_timeout = '5s';
   SELECT desirelines.rekey_adopted_activities() AS renumbered;
   COMMIT;
   ```

   Record `renumbered` and confirm the adopted count is zero. The temporary
   helper identifies adoption by equality between the two IDs; a coincidentally
   equal sequence ID can also match, including one assigned by a sweep. If a
   row still matches after the sweep, repeat it and re-count before proceeding.
   If the lock
   timeout aborts the transaction, `ROLLBACK` and retry after the busy writer
   finishes. The sweep holds writers while routes, region tags and mappings
   follow the re-key; reads continue.
5. Verify a new activity arriving by webhook gets a desirelines ID, appears in
   the app, and links to its Strava activity using the mapping's external ID.
   Keep the second-athlete allowlist gate until the new writers and these
   checks are complete.

A rollback to a revision that adopts Strava IDs reopens this transition. Keep
the re-key helper until allocation has been restored and the post-rollout
check and any required sweep have run again.

### Activity-ID cleanup rollout

Cleanup takes two releases because deployments migrate the database before
updating writer images. Ship the compatibility release first:

1. Apply V0014. It preserves existing tombstones, makes `external_id` writable,
   and temporarily bridges inserts that supply either the legacy `id` or the
   external ID. The legacy primary key stays in place, so the previous writer's
   `ON CONFLICT (id)` still works. External IDs must remain canonical bigint
   strings during this stage; equal IDs across sources are still restricted by
   that legacy key. The bridge takes a transaction advisory lock on the legacy
   ID before either writer's conflict check, preventing simultaneous tombstone
   inserts from failing on their different unique indexes. Other IDs can still
   be deleted concurrently; final cleanup removes this lock with the bridge.
2. Deploy the writer that inserts tombstones by `(source, external_id)` and
   activity rows with `OVERRIDING SYSTEM VALUE`, selecting the internal ID from
   the mapping. The activity identity stays `GENERATED BY DEFAULT` in this
   release. CREATE, enriched UPDATE, and backfill share the override path.
3. Confirm `postgres-writer` and `backfill` use the compatibility image in dev
   and prod. Drain old writer requests and old backfill executions. Check live
   ingestion and deletion-tombstone behavior before proceeding. Until final
   cleanup, the previous sequence-allocating writer remains a compatible
   rollback target; a new writer requires V0014 and cannot run against V0013.

V0015 is the subsequent release that removes the legacy tombstone `id`, its bridge
trigger/function/check, and the temporary re-key helper, makes
`(source, external_id)` the tombstone primary key and tightens the activity
identity to `GENERATED ALWAYS`. Before applying V0015, verify both environments'
compatibility images, old request/backfill drainage, fresh ingestion/deletion behavior, and zero adopted
IDs. The migration repeats the adopted-ID count while holding mapping/activity
table locks and refuses cleanup if any remain; it does not run a sweep or
renumber data. Investigate a nonzero count with the V0014 schema/helper retained.
The equality check is a conservative transition heuristic, not durable identity
provenance: an allocated ID can coincidentally equal its source ID.

V0015 preserves existing internal IDs, source keys and deletion metadata. Local
seeds claim source mappings and insert under their sequence IDs directly;
explicit-ID fixtures intentionally use `OVERRIDING SYSTEM VALUE`. Historical
migration/old-writer tests use isolated databases through V0014, rather than
downgrading the current integration-test database. Their login needs CREATEDB
(local/CI PostGIS uses the `desirelines` superuser).

After cleanup, rolling back to a writer that inserts the legacy tombstone column or omits the identity override is incompatible; use a
forward fix instead.

`test_activity_id_cleanup.py` exercises the old and new tombstone statements,
preservation through V0014, and the new writer under the final schema.
Tests run the real V0015 migration, verify metadata preservation and refusal
when adopted IDs remain, and cover the final-schema writer plus idempotent seeds.
Transactional changes are rolled back within each isolated historical database.

## Creating New Migrations

**Naming**: `V{NNNN}__{description}.sql` (e.g., `V0003__add_goals_table.sql`)

- Use 4-digit zero-padded sequential numbers
- Never modify existing migrations once applied

For an activity column, also follow the
[persisted activity compatibility checklist](../activities/). It requires the
PostgreSQL writer mapping, live path, summary backfill behavior, fixtures, and
historical-data action to move with the Flyway change.

**Template**:

```sql
SET ROLE desirelines_ddl_grp;

-- Your DDL changes here (use schema-qualified names)
CREATE TABLE desirelines.new_table (...);
CREATE INDEX idx_new_table ON desirelines.new_table(...);

RESET ROLE;
```

**Workflow**: Test locally → commit → run in dev → run in prod

**Rollback**: Forward-fix migrations only (Flyway Community doesn't support undo)

## Directory Structure

```
schemas/database/
├── migrations/              # Versioned migrations (V0001__, V0002__, ...)
├── callbacks/               # Flyway callbacks (run before/after migrations)
│   └── beforeMigrate.sql    # Safety net: creates role groups/schemas if missing
├── local/                   # Local dev only (mounted via docker-compose)
│   ├── init-roles.sql       # Docker entrypoint: creates roles, schemas, grants
│   ├── R__01_seed_data.sql  # Repeatable: 1000 sanitized activities
│   └── R__02_shift_timestamps.sql  # Repeatable: shifts seed data to appear recent
├── flyway.conf              # Flyway configuration
└── Dockerfile               # Flyway container for local dev
```

## Configuration

**Flyway config**: `flyway.conf`

- URL: Built from `DB_HOST`, `DB_PORT`, `DB_NAME` env vars (local) or `FLYWAY_URL` (prod)
- Migrations: `filesystem:/flyway/sql` (maps to `migrations/` directory)
- Callbacks: `filesystem:/flyway/callbacks` (safety net for local dev)
- Default schema: `desirelines`

**Schemas**:

- `desirelines` - Application tables
- `extensions` - PostGIS
- `public` - Unused

**Role groups** (created manually before migrations, see playbook):

- `desirelines_ddl_grp` - Owns schemas/objects (used by Flyway, admin)
- `desirelines_dml_grp` - Read/write data (used by app)
- `desirelines_ro_grp` - Read-only (used for analytics)

**Current migrations**: see the `migrations/` directory — the versioned
`V{NNNN}__*.sql` files are self-describing and are the source of truth (a
hand-maintained list here drifts on every new migration).

## Related Documentation

- **[Database Setup Playbook](../../docs/guides/database-setup.md)** - Step-by-step new database setup
- [Flyway Documentation](https://flywaydb.org/documentation/)
- [Neon PostgreSQL Documentation](https://neon.tech/docs)
