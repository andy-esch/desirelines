-- SAFETY NET: Ensure critical prerequisites exist before migrations.
-- Runs before every `flyway migrate` invocation (local and production).
--
-- This is NOT the authoritative source for local dev setup - that's
-- local/init-roles.sql which runs at Docker entrypoint time.
--
-- This callback handles the common case where a developer forgets
-- `docker compose down -v` and role groups are missing from a stale volume.
--
-- Intentionally minimal - only creates role groups and schemas (no passwords,
-- no login roles) so it's safe to run in any environment.
--
-- See: local/init-roles.sql for full local dev setup
-- See: docs/guides/database-setup.md for production setup

-- =============================================================================
-- ROLE GROUPS (needed by V0001)
-- =============================================================================
DO $$ BEGIN
    CREATE ROLE desirelines_ddl_grp NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE ROLE desirelines_dml_grp NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE ROLE desirelines_ro_grp NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- SCHEMAS (needed by V0001)
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS desirelines;
CREATE SCHEMA IF NOT EXISTS extensions;

-- =============================================================================
-- EXTENSIONS (needed by V0003)
-- =============================================================================
-- PostGIS is required for geometry columns in activity_routes.
-- Local/CI: runs as superuser (desirelines), so CREATE EXTENSION works.
-- Production (Neon): already installed manually by neondb_owner in extensions
-- schema (see docs/guides/database-setup.md Section 3). IF NOT EXISTS is a no-op.
CREATE EXTENSION IF NOT EXISTS postgis;
