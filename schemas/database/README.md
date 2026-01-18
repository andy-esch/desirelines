# Database Migrations

Flyway-based database migrations for Desirelines PostgreSQL (Neon-hosted).

For setting up a database from scratch read [Database Setup Playbook](../../docs/guides/database-setup.md), a step-by-step guide to setting up a new database for this project.

## Local Development

```bash
# Start PostgreSQL
docker compose --profile backend up -d postgres

# Run migrations
just db-migrate-local

# Connect to database
just db-connect-local
```

**Troubleshooting**: If migrations fail with "role does not exist", the Flyway `beforeMigrate` callback should self-heal by creating missing role groups. If it still fails, reset with `docker compose down -v` and try again.

## Production Deployment

**Strategy**: Manual via Make targets. Credentials in Secret Manager stored as connection strings, fetched and parsed automatically by scripts.

```bash
# Dev environment
just db-migrate-dev-info     # Check status (dry-run)
just db-migrate-dev          # Run migrations
just db-connect-dev          # Connect (read-only)
just db-connect-dev-admin    # Connect (admin)

# Prod environment (requires "yes" confirmation)
just db-migrate-prod-info    # Check status
just db-migrate-prod         # Run migrations
just db-connect-prod         # Connect (read-only)
just db-connect-prod-admin   # Connect (admin)
```

**First-time setup**: See [Database Setup Playbook](../../docs/guides/database-setup.md) for complete steps including pre-migration setup (schemas, extensions, roles) that must be done as `neondb_owner` before Flyway runs.

## Creating New Migrations

**Naming**: `V{NNNN}__{description}.sql` (e.g., `V0003__add_goals_table.sql`)

- Use 4-digit zero-padded sequential numbers
- Never modify existing migrations once applied

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

**Current migrations**:

- `V0001__role_groups.sql` - Role group privileges and default grants
- `V0002__activities_table.sql` - Activities table and indexes

## Related Documentation

- **[Database Setup Playbook](../../docs/guides/database-setup.md)** - Step-by-step new database setup
- [Flyway Documentation](https://flywaydb.org/documentation/)
- [Neon PostgreSQL Documentation](https://neon.tech/docs)
