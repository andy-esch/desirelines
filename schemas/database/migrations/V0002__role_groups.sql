-- Security: Role Groups and Privileges
-- Migration: V0002
-- Concern: Role-based access control setup
--
-- Role hierarchy:
--   ddl_grp  - Schema owners, can CREATE/ALTER/DROP (Flyway, admins)
--   dml_grp  - Application runtime, can SELECT/INSERT/UPDATE/DELETE
--   ro_grp   - Read-only access for reporting/analytics
--
-- IMPORTANT: Role groups must be created MANUALLY before running migrations.
-- Neon restricts role creation to neondb_owner, which Flyway cannot assume.
--
-- Pre-migration setup (run as neondb_owner):
--   CREATE ROLE desirelines_ddl_grp NOINHERIT;
--   CREATE ROLE desirelines_dml_grp NOINHERIT;
--   CREATE ROLE desirelines_ro_grp NOINHERIT;
--   GRANT desirelines_ddl_grp TO desirelines_flyway;

-- =============================================================================
-- SCHEMA PRIVILEGES
-- =============================================================================

-- DDL group: Full access (create objects)
GRANT USAGE, CREATE ON SCHEMA desirelines TO desirelines_ddl_grp;
GRANT USAGE, CREATE ON SCHEMA extensions TO desirelines_ddl_grp;

-- DML group: Usage only (access objects, no DDL)
GRANT USAGE ON SCHEMA desirelines TO desirelines_dml_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_dml_grp;

-- Read-only group: Usage only
GRANT USAGE ON SCHEMA desirelines TO desirelines_ro_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_ro_grp;

-- =============================================================================
-- DEFAULT PRIVILEGES (for future objects)
-- =============================================================================

-- Objects created by ddl_grp automatically grant to dml_grp
ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO desirelines_dml_grp;

ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT USAGE, SELECT ON SEQUENCES TO desirelines_dml_grp;

-- Objects created by ddl_grp automatically grant SELECT to ro_grp
ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT SELECT ON TABLES TO desirelines_ro_grp;

-- =============================================================================
-- SEARCH PATH DEFAULTS
-- =============================================================================

-- NOTE: search_path must be set manually as neondb_owner (requires CREATEROLE):
--   ALTER ROLE desirelines_dml_grp SET search_path = desirelines, extensions, public;
--   ALTER ROLE desirelines_ro_grp SET search_path = desirelines, extensions, public;
