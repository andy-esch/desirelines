-- AUTHORITATIVE SOURCE for local development database setup.
-- Runs at PostgreSQL init time (docker-entrypoint-initdb.d) before Flyway.
--
-- Creates everything that Neon's neondb_owner would create in production:
--   1. Role groups (permission containers)
--   2. Schemas with ownership transfer
--   3. Login roles with local dev passwords, grants, and search paths
--
-- Note: Role groups and schemas are also created by callbacks/beforeMigrate.sql
-- as a safety net for stale volumes. That redundancy is intentional - this file
-- is the source of truth, the callback is just a fallback.
--
-- See: callbacks/beforeMigrate.sql for the Flyway safety net
-- See: docs/guides/database-setup.md for production setup
-- NOTE: PostGIS is installed by the postgis/postgis Docker image (in public schema)

-- =============================================================================
-- ROLE GROUPS (permission containers, NOLOGIN)
-- See: docs/guides/database-setup.md Section 2
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'desirelines_ddl_grp') THEN
        CREATE ROLE desirelines_ddl_grp NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'desirelines_dml_grp') THEN
        CREATE ROLE desirelines_dml_grp NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'desirelines_ro_grp') THEN
        CREATE ROLE desirelines_ro_grp NOINHERIT;
    END IF;
END $$;

-- =============================================================================
-- SCHEMAS
-- See: docs/guides/database-setup.md Section 3
-- =============================================================================

-- Create schemas (extensions schema needed for V0001 migration compatibility)
CREATE SCHEMA IF NOT EXISTS desirelines;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Transfer ownership to ddl_grp
ALTER SCHEMA desirelines OWNER TO desirelines_ddl_grp;
ALTER SCHEMA extensions OWNER TO desirelines_ddl_grp;

-- Grant usage to other role groups
GRANT USAGE ON SCHEMA desirelines TO desirelines_dml_grp, desirelines_ro_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_dml_grp, desirelines_ro_grp;

-- NOTE: PostGIS extension is handled by the postgis/postgis Docker image
-- and installed in the public schema. For prod (Neon), it's installed
-- manually in the extensions schema per docs/guides/database-setup.md

-- =============================================================================
-- LOGIN ROLES
-- See: docs/guides/database-setup.md Section 4
-- Service accounts with simple passwords for local dev
-- =============================================================================

-- Flyway (runs migrations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flyway') THEN
        CREATE ROLE flyway WITH LOGIN PASSWORD 'flyway_local';
    END IF;
END $$;
GRANT desirelines_ddl_grp TO flyway;
ALTER ROLE flyway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE flyway IS 'Flyway database migrations (local dev)';

-- postgres-writer service
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'writer') THEN
        CREATE ROLE writer WITH LOGIN PASSWORD 'writer_local';
    END IF;
END $$;
GRANT desirelines_dml_grp TO writer;
ALTER ROLE writer SET search_path = desirelines, extensions, public;
COMMENT ON ROLE writer IS 'postgres-writer Cloud Run service (local dev)';

-- apigateway service (read-only)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'apigateway') THEN
        CREATE ROLE apigateway WITH LOGIN PASSWORD 'apigateway_local';
    END IF;
END $$;
GRANT desirelines_ro_grp TO apigateway;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE apigateway IS 'apigateway Cloud Run service (local dev)';

-- reader (general read-only access)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reader') THEN
        CREATE ROLE reader WITH LOGIN PASSWORD 'reader_local';
    END IF;
END $$;
GRANT desirelines_ro_grp TO reader;
ALTER ROLE reader SET search_path = desirelines, extensions, public;
COMMENT ON ROLE reader IS 'General read-only access (local dev)';

-- Admin (manual ops)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin WITH LOGIN PASSWORD 'admin_local';
    END IF;
END $$;
GRANT desirelines_ddl_grp TO admin;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
COMMENT ON ROLE admin IS 'Manual admin access (local dev)';
