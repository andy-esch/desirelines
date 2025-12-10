-- Setup Individual Login Roles for Desirelines PostgreSQL
--
-- This script creates individual login roles and grants them membership
-- in the appropriate role groups (ddl_grp, dml_grp, ro_grp).
--
-- Prerequisites:
-- - V0001 migration must be applied (creates role groups)
-- - Run this script as the Neon default role (has neon_superuser permissions)
--
-- Usage:
--   psql "postgres://default_user:password@host/db" -f scripts/database/setup-roles.sql
--
-- NOTE: Replace the placeholder passwords with strong generated passwords!
--       Use a password manager to generate and store them securely.

-- =============================================================================
-- PART 1: CREATE INDIVIDUAL LOGIN ROLES
-- =============================================================================

-- Flyway migration user (DDL permissions)
CREATE ROLE desirelines_flyway LOGIN PASSWORD 'CHANGE_ME_FLYWAY_PASSWORD';
COMMENT ON ROLE desirelines_flyway IS 'Migration user for Flyway (DDL operations)';

-- Application runtime user (DML permissions)
CREATE ROLE desirelines_app LOGIN PASSWORD 'CHANGE_ME_APP_PASSWORD';
COMMENT ON ROLE desirelines_app IS 'Application runtime user (read/write data)';

-- Admin user for manual operations (DDL permissions)
CREATE ROLE desirelines_admin LOGIN PASSWORD 'CHANGE_ME_ADMIN_PASSWORD';
COMMENT ON ROLE desirelines_admin IS 'Admin user for manual database operations';

-- Read-only user for analytics/reporting
CREATE ROLE desirelines_readonly LOGIN PASSWORD 'CHANGE_ME_READONLY_PASSWORD';
COMMENT ON ROLE desirelines_readonly IS 'Read-only user for analytics and reporting';

-- =============================================================================
-- PART 2: GRANT ROLE GROUP MEMBERSHIPS
-- =============================================================================

-- Grant DDL permissions (create/modify schema)
GRANT desirelines_ddl_grp TO desirelines_flyway;
GRANT desirelines_ddl_grp TO desirelines_admin;

-- Grant DML permissions (read/write data)
GRANT desirelines_dml_grp TO desirelines_app;

-- Grant read-only permissions
GRANT desirelines_ro_grp TO desirelines_readonly;

-- =============================================================================
-- PART 3: VERIFY ROLES CREATED
-- =============================================================================

-- Display all roles
\echo '✅ Roles created successfully!'
\echo ''
\echo 'Role memberships:'
\du

-- =============================================================================
-- NEXT STEPS
-- =============================================================================

\echo ''
\echo '📋 Next Steps:'
\echo '1. Update passwords in this script with strong generated passwords'
\echo '2. Create separate connection string secrets for each role:'
\echo '   - postgres-connection-string-{env}-flyway'
\echo '   - postgres-connection-string-{env}-app'
\echo '   - postgres-connection-string-{env}-admin'
\echo '   - postgres-connection-string-{env}-readonly'
\echo '3. Update Secret Manager with role-specific connection strings'
\echo '4. Test connectivity with each role'
\echo ''
