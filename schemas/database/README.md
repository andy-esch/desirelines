# Database Migrations

Flyway-based database migrations for Desirelines PostgreSQL (Neon-hosted).

For setting up a database from scratch read [Database Setup Playbook](../../docs/guides/database-setup.md), a step-by-step guide to setting up a new database for this project.

## Local Development

```bash
# Start PostgreSQL
docker compose --profile backend up -d postgres

# Run migrations
make db-migrate-local

# Connect to database
make db-connect-local
```

## Production Deployment

**Strategy**: Manual via Make targets. Credentials in Secret Manager stored as connection strings, fetched and parsed automatically by scripts.

```bash
# Dev environment
make db-migrate-dev-info     # Check status (dry-run)
make db-migrate-dev          # Run migrations
make db-connect-dev          # Connect (read-only)
make db-connect-dev-admin    # Connect (admin)

# Prod environment (requires "yes" confirmation)
make db-migrate-prod-info    # Check status
make db-migrate-prod         # Run migrations
make db-connect-prod         # Connect (read-only)
make db-connect-prod-admin   # Connect (admin)
```

**First-time setup** (once per environment):

1. Run `scripts/database/setup-roles.sql` to create individual login roles
2. Store credentials in Secret Manager as `postgres-connection-string-{env}`
3. Run initial migrations with `make db-migrate-{env}`

See [`postgresql-06-production-database-setup.md`](/planning/tasks/ready-to-start/postgresql-06-production-database-setup.md) in planning repo for detailed setup guide.

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

## Configuration

**Flyway config**: `flyway.conf`

- URL: Built from `DB_HOST`, `DB_PORT`, `DB_NAME` env vars (local) or `FLYWAY_URL` (prod)
- Migrations: `filesystem:/flyway/sql` (maps to `migrations/` directory)
- Default schema: `desirelines`

**Current migrations**: in `schemas/database/migrations/`

**Schemas**:

- `desirelines` - Application tables
- `extensions` - PostGIS
- `public` - Unused

**Role groups** (created by V0001):

- `desirelines_ddl_grp` - Owns all objects (used by Flyway, admin)
- `desirelines_dml_grp` - Read/write data (used by app)
- `desirelines_ro_grp` - Read-only (used for analytics)

See [`postgresql-roles-schema-best-practices.md`](/planning/research/postgresql-roles-schema-best-practices.md) for role group pattern details.

## Related Documentation

- **[Database Setup Playbook](../../docs/guides/database-setup.md)** - Step-by-step new database setup
- [Flyway Documentation](https://flywaydb.org/documentation/)
- [Neon PostgreSQL Documentation](https://neon.tech/docs)
