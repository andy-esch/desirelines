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

Connect as `neondb_owner`:

```sql
-- Role groups (NOLOGIN - these are permission containers)
CREATE ROLE desirelines_ddl_grp NOINHERIT;
CREATE ROLE desirelines_dml_grp NOINHERIT;
CREATE ROLE desirelines_ro_grp NOINHERIT;

-- Verify
\du desirelines_*
```

## 3. Create Schemas and Extensions (as neondb_owner)

```sql
-- Create schemas
CREATE SCHEMA IF NOT EXISTS desirelines;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Install PostGIS (requires superuser, can't be done by Flyway)
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- Transfer ownership to ddl_grp (requires membership first)
GRANT desirelines_ddl_grp TO neondb_owner;
ALTER SCHEMA desirelines OWNER TO desirelines_ddl_grp;
ALTER SCHEMA extensions OWNER TO desirelines_ddl_grp;

-- Grant usage to other role groups
GRANT USAGE ON SCHEMA desirelines TO desirelines_dml_grp, desirelines_ro_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_dml_grp, desirelines_ro_grp;

-- Verify
\dn
SELECT extensions.PostGIS_Version();
```

## 4. Create Login Roles

Still as `neondb_owner`, create service accounts. This script is also in [`/schemas/database/create-login-roles.sql`](../../schemas/database/create-login-roles.sql) and a variation [`/schemas/database/local/init-roles.sql`](../../schemas/database/local/init-roles.sql)

```sql
-- Flyway (runs migrations)
CREATE ROLE flyway WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ddl_grp TO flyway;
ALTER ROLE flyway SET search_path = desirelines, extensions, public;

-- postgres-writer service
CREATE ROLE writer WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_dml_grp TO writer;
ALTER ROLE writer SET search_path = desirelines, extensions, public;

-- apigateway service (read-only)
CREATE ROLE apigateway WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ro_grp TO apigateway;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;

-- reader (general read-only access)
CREATE ROLE reader WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ro_grp TO reader;
ALTER ROLE reader SET search_path = desirelines, extensions, public;

-- Admin (manual ops)
CREATE ROLE admin WITH LOGIN PASSWORD 'GENERATE_32CHAR';
GRANT desirelines_ddl_grp TO admin;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
```

## 5. Store Credentials in Secret Manager

Secret naming convention: `postgres-conn-{role}`

```bash
ENV=dev  # or prod
HOST="ep-xxx-pooler.us-east-2.aws.neon.tech"  # your Neon pooler host

# Create secrets for each role (replace PASSWORD with actual values)
# flyway
echo -n "postgres://flyway:PASSWORD@${HOST}/desirelines?sslmode=require&channel_binding=require&application_name=flyway" | \
  gcloud secrets create postgres-conn-flyway \
    --project=desirelines-$ENV --replication-policy=automatic --data-file=-

# writer
echo -n "postgres://writer:PASSWORD@${HOST}/desirelines?sslmode=require&channel_binding=require&application_name=postgres-writer" | \
  gcloud secrets create postgres-conn-writer \
    --project=desirelines-$ENV --replication-policy=automatic --data-file=-

# apigateway
echo -n "postgres://apigateway:PASSWORD@${HOST}/desirelines?sslmode=require&channel_binding=require&application_name=apigateway" | \
  gcloud secrets create postgres-conn-apigateway \
    --project=desirelines-$ENV --replication-policy=automatic --data-file=-

# reader
echo -n "postgres://reader:PASSWORD@${HOST}/desirelines?sslmode=require&channel_binding=require&application_name=reader" | \
  gcloud secrets create postgres-conn-reader \
    --project=desirelines-$ENV --replication-policy=automatic --data-file=-

# admin
echo -n "postgres://admin:PASSWORD@${HOST}/desirelines?sslmode=require&channel_binding=require&application_name=admin" | \
  gcloud secrets create postgres-conn-admin \
    --project=desirelines-$ENV --replication-policy=automatic --data-file=-

# Verify
gcloud secrets list --project=desirelines-$ENV --filter="name:postgres-conn"
```

## 6. Run Migrations

```bash
# Check status first
just db-migrate-dev-info

# Run migrations
just db-migrate-dev

# Verify tables created
just db-connect-dev
\dt desirelines.*
```

## 7. Verify Service Connectivity

```bash
# Test apigateway role (read-only)
psql "postgres://apigateway:PASSWORD@HOST-pooler/desirelines?sslmode=require" \
  -c "SELECT count(*) FROM desirelines.activities;"

# Test writer role (should be able to insert)
psql "postgres://writer:PASSWORD@HOST-pooler/desirelines?sslmode=require" \
  -c "SELECT count(*) FROM desirelines.activities;"
```

## Quick Reference

| Role         | Group   | Purpose                   |
| ------------ | ------- | ------------------------- |
| `flyway`     | ddl_grp | Migrations                |
| `writer`     | dml_grp | postgres-writer service   |
| `apigateway` | ro_grp  | API Gateway (read-only)   |
| `reader`     | ro_grp  | General read-only access  |
| `admin`      | ddl_grp | Manual admin access       |

| Just Recipe            | Description              |
| ---------------------- | ------------------------ |
| `db-migrate-dev`       | Run migrations (dev)     |
| `db-migrate-dev-info`  | Check migration status   |
| `db-connect-dev`       | Connect psql (read-only) |
| `db-connect-dev-admin` | Connect psql (admin)     |
