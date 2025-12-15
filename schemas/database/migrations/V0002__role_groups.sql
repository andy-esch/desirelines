-- Security: Role Groups and Privileges
-- Migration: V0002
-- Concern: Role-based access control setup
--
-- Role hierarchy:
--   ddl_grp  - Schema owners, can CREATE/ALTER/DROP (Flyway, admins)
--   dml_grp  - Application runtime, can SELECT/INSERT/UPDATE/DELETE
--   ro_grp   - Read-only access for reporting/analytics
--
-- Login roles (created separately in Neon console) inherit from these groups.

-- =============================================================================
-- ROLE GROUPS (NOLOGIN)
-- =============================================================================

-- DDL Group: Owns all database objects, can create/modify schema
CREATE ROLE desirelines_ddl_grp NOINHERIT;
COMMENT ON ROLE desirelines_ddl_grp IS 'DDL operations - owns all objects (Flyway, admins)';

-- DML Group: Read/write access to data, no DDL permissions
CREATE ROLE desirelines_dml_grp NOINHERIT;
COMMENT ON ROLE desirelines_dml_grp IS 'DML operations - application runtime (writer service)';

-- Read-Only Group: SELECT-only access for reporting/analytics
CREATE ROLE desirelines_ro_grp NOINHERIT;
COMMENT ON ROLE desirelines_ro_grp IS 'Read-only access (apigateway, reporting)';

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

-- Set search_path so applications use correct schemas automatically
ALTER ROLE desirelines_dml_grp SET search_path = desirelines, extensions, public;
ALTER ROLE desirelines_ro_grp SET search_path = desirelines, extensions, public;

-- =============================================================================
-- GRANT DDL GROUP TO CURRENT USER
-- =============================================================================

-- Allow Flyway (or local superuser) to SET ROLE to ddl_grp for object creation
-- This ensures all objects are owned by ddl_grp, not the connecting user
GRANT desirelines_ddl_grp TO CURRENT_USER;
