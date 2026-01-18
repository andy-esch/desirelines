-- Safety net: ensure critical prerequisites exist before migrations
-- This runs before every `flyway migrate` invocation.
--
-- Handles the common case where a developer forgets `docker compose down -v`
-- and role groups are missing from a stale volume. Login roles are NOT created
-- here intentionally - if those are missing, the user should see an auth error
-- and know to reset with `docker compose down -v`.
--
-- See: docs/guides/database-setup.md for production setup guide

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
