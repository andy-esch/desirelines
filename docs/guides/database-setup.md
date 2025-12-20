# Database Setup Playbook

Step-by-step guide for setting up a new PostgreSQL database (Neon).

## Prerequisites

- Neon account with project created
- `gcloud` CLI authenticated
- `psql` installed locally

## 1. Create Database in Neon Console

1. Go to [Neon Console](https://console.neon.tech)
2. Create new project or use existing
3. Note the **pooled connection string** (ends in `-pooler`)
4. Copy the `neondb_owner` password

## 2. Create Role Groups (as neondb_owner)

Connect as `neondb_owner` and run:

```sql
-- Role groups (NOLOGIN - these are permission containers)
CREATE ROLE desirelines_ddl_grp NOINHERIT;
CREATE ROLE desirelines_dml_grp NOINHERIT;
CREATE ROLE desirelines_ro_grp NOINHERIT;

-- Verify
\du desirelines_*
```

## 3. Create Login Roles

Still as `neondb_owner`, create service accounts:

```sql
-- Flyway (runs migrations)
CREATE ROLE desirelines_flyway WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ddl_grp TO desirelines_flyway;
ALTER ROLE desirelines_flyway SET search_path = desirelines, extensions, public;

-- postgres-writer service
CREATE ROLE writer WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_dml_grp TO writer;
ALTER ROLE writer SET search_path = desirelines, extensions, public;

-- apigateway service (read-only)
CREATE ROLE apigateway WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ro_grp TO apigateway;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;

-- Admin (manual ops)
CREATE ROLE admin WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ddl_grp TO admin;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
```

Generate passwords: `openssl rand -base64 24`

## 4. Store Credentials in Secret Manager

```bash
ENV=dev  # or prod

# Flyway connection (for migrations)
echo -n "postgres://desirelines_flyway:PASSWORD@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require" | \
  gcloud secrets create postgres-flyway-connection-string-$ENV \
    --project=desirelines-$ENV \
    --replication-policy=automatic \
    --data-file=-

# App connection (for postgres-writer)
echo -n "postgres://writer:PASSWORD@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require" | \
  gcloud secrets create postgres-connection-string-$ENV \
    --project=desirelines-$ENV \
    --replication-policy=automatic \
    --data-file=-

# Verify
gcloud secrets list --project=desirelines-$ENV
```

## 5. Run Migrations

```bash
# Check status first
make db-migrate-dev-info

# Run migrations
make db-migrate-dev

# Verify tables created
make db-connect-dev
\dt desirelines.*
```

## 6. Verify Service Connectivity

```bash
# Test apigateway role (read-only)
psql "postgres://apigateway:PASSWORD@HOST-pooler/neondb?sslmode=require" \
  -c "SELECT count(*) FROM desirelines.activities;"

# Test writer role
psql "postgres://writer:PASSWORD@HOST-pooler/neondb?sslmode=require" \
  -c "INSERT INTO desirelines.activities (id, ...) VALUES (...);"  # should work
```

## Quick Reference

| Role | Group | Purpose |
|------|-------|---------|
| `desirelines_flyway` | ddl_grp | Migrations |
| `writer` | dml_grp | postgres-writer service |
| `apigateway` | ro_grp | API Gateway (read-only) |
| `admin` | ddl_grp | Manual admin access |

| Make Target | Description |
|-------------|-------------|
| `db-migrate-dev` | Run migrations (dev) |
| `db-migrate-dev-info` | Check migration status |
| `db-connect-dev` | Connect psql (read-only) |
| `db-connect-dev-admin` | Connect psql (admin) |

## Troubleshooting

**"permission denied for schema desirelines"**
- Role groups not created or role not granted membership
- Fix: `GRANT desirelines_dml_grp TO writer;`

**"role does not exist"**
- Run step 2 first (create role groups)

**Flyway can't create tables**
- Flyway role needs ddl_grp: `GRANT desirelines_ddl_grp TO desirelines_flyway;`
