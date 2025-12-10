-- Initial schema for Desirelines PostgreSQL backend
-- Migration: V0001
-- Description: Create schemas, roles, extensions, and core tables

-- =============================================================================
-- PART 1: CREATE SCHEMAS
-- =============================================================================

-- Desirelines application schema: All business logic tables
CREATE SCHEMA IF NOT EXISTS desirelines;

-- Extensions schema: PostGIS and other extensions
CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA desirelines IS 'Desirelines application tables and business logic';
COMMENT ON SCHEMA extensions IS 'PostgreSQL extensions (PostGIS, etc.)';

-- =============================================================================
-- PART 2: CREATE ROLE GROUPS (NO LOGIN)
-- =============================================================================

-- DDL Group: Owns all database objects, can create/modify schema
CREATE ROLE desirelines_ddl_grp NOINHERIT;
COMMENT ON ROLE desirelines_ddl_grp IS 'Group role for DDL operations (owns all objects)';

-- DML Group: Read/write access to data, no DDL permissions
CREATE ROLE desirelines_dml_grp NOINHERIT;
COMMENT ON ROLE desirelines_dml_grp IS 'Group role for DML operations (application runtime)';

-- Read-Only Group: SELECT-only access for reporting/analytics
CREATE ROLE desirelines_ro_grp NOINHERIT;
COMMENT ON ROLE desirelines_ro_grp IS 'Group role for read-only access (reporting/analytics)';

-- =============================================================================
-- PART 3: GRANT SCHEMA PRIVILEGES TO ROLE GROUPS
-- =============================================================================

-- DDL group: Full access to desirelines schema (create objects, use)
GRANT USAGE, CREATE ON SCHEMA desirelines TO desirelines_ddl_grp;
GRANT USAGE, CREATE ON SCHEMA extensions TO desirelines_ddl_grp;

-- DML group: Usage only (can access objects, but not create new ones)
GRANT USAGE ON SCHEMA desirelines TO desirelines_dml_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_dml_grp;

-- Read-only group: Usage only
GRANT USAGE ON SCHEMA desirelines TO desirelines_ro_grp;
GRANT USAGE ON SCHEMA extensions TO desirelines_ro_grp;

-- =============================================================================
-- PART 4: CONFIGURE ROLE SEARCH PATHS
-- =============================================================================

-- Set search_path for role groups so applications automatically use correct schemas
ALTER ROLE desirelines_dml_grp SET search_path = desirelines, extensions, public;
ALTER ROLE desirelines_ro_grp SET search_path = desirelines, extensions, public;

-- =============================================================================
-- PART 5: GRANT CURRENT USER TO DDL GROUP
-- =============================================================================

-- Grant current user (flyway or local superuser) membership in ddl_grp
-- This allows us to use SET ROLE to switch to ddl_grp for object creation
-- Works for both:
--   - Local dev: desirelines (superuser)
--   - Production: Neon default role or flyway user
GRANT desirelines_ddl_grp TO CURRENT_USER;

-- =============================================================================
-- PART 6: SWITCH TO DDL GROUP ROLE
-- =============================================================================

-- All objects created from this point forward will be owned by desirelines_ddl_grp
-- This ensures consistent ownership and allows default privileges to work correctly
SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- PART 7: CREATE EXTENSIONS
-- =============================================================================

-- PostGIS: Geospatial extension for future map-based features
-- Install in extensions schema to keep 900+ functions out of app namespace
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- =============================================================================
-- PART 8: CREATE APPLICATION TABLES
-- =============================================================================

-- Activities table (primary entity)
-- Stores Strava activity data synced via webhooks
CREATE TABLE desirelines.activities (
    id BIGINT PRIMARY KEY,                    -- Strava activity ID
    user_id VARCHAR(255) NOT NULL,            -- User identifier
    name VARCHAR(500),                        -- Activity name
    type VARCHAR(50) NOT NULL,                -- Strava activity type (Run, Ride, etc.)
    sport VARCHAR(50) NOT NULL,               -- Categorized sport (running, cycling, etc.)
    start_date_local TIMESTAMP NOT NULL,      -- Local start time
    distance FLOAT NOT NULL,                  -- Distance in meters
    moving_time INTEGER NOT NULL,             -- Moving time in seconds
    elapsed_time INTEGER NOT NULL,            -- Total elapsed time in seconds
    total_elevation_gain FLOAT,               -- Elevation gain in meters
    average_speed FLOAT,                      -- Average speed in m/s
    max_speed FLOAT,                          -- Max speed in m/s
    average_heartrate FLOAT,                  -- Average heart rate
    max_heartrate FLOAT,                      -- Max heart rate
    year INTEGER NOT NULL,                    -- Extracted year for partitioning
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- PART 9: TABLE COMMENTS
-- =============================================================================

COMMENT ON TABLE desirelines.activities IS 'Strava activities synced from webhooks';

-- =============================================================================
-- PART 10: SET DEFAULT PRIVILEGES FOR FUTURE OBJECTS
-- =============================================================================

-- Default privileges for DML group (read/write)
-- Any future tables created by ddl_grp will automatically grant these permissions
ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO desirelines_dml_grp;

ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT USAGE, SELECT ON SEQUENCES TO desirelines_dml_grp;

-- Default privileges for read-only group
ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines
  GRANT SELECT ON TABLES TO desirelines_ro_grp;

-- =============================================================================
-- PART 11: GRANT PRIVILEGES ON EXISTING OBJECTS
-- =============================================================================

-- Grant privileges on tables and sequences created in this migration
-- (Default privileges only apply to FUTURE objects, not existing ones)
-- Note: Use explicit table names to avoid trying to grant on flyway_schema_history
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.activities TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.activities TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original connecting user so Flyway can update its tracking table
RESET ROLE;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

-- Summary:
-- ✓ Created schemas: desirelines, extensions
-- ✓ Created role groups: ddl_grp, dml_grp, ro_grp
-- ✓ Installed PostGIS in extensions schema
-- ✓ Created tables: activities (owned by ddl_grp)
-- ✓ Set default privileges for future objects
-- ✓ Granted privileges on existing objects
--
-- Next steps:
-- - Create individual login roles (flyway, app, admin, readonly)
-- - Grant them membership in appropriate role groups
-- - See README.md for user creation instructions
