-- PRODUCTION REFERENCE: Login roles for Desirelines services.
-- Copy and run manually in Neon console (dev and prod separately).
-- Replace GENERATE_SECURE_32CHAR_PASSWORD with actual secure passwords.
--
-- These are LOGIN roles (can authenticate), unlike role GROUPS (NOLOGIN).
-- Role groups must be created first - see docs/guides/database-setup.md Section 2.
--
-- See: local/init-roles.sql for the local dev equivalent (with hardcoded passwords)
-- Secret naming convention: postgres-conn-{role}

-- =============================================================================
-- Flyway migrations (DDL via ddl_grp)
-- Secret: postgres-conn-flyway
-- =============================================================================
CREATE ROLE flyway WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ddl_grp TO flyway;
ALTER ROLE flyway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE flyway IS 'Flyway database migrations';

-- =============================================================================
-- postgres-writer service (read/write via dml_grp)
-- Secret: postgres-conn-writer
-- =============================================================================
CREATE ROLE writer WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_dml_grp TO writer;
ALTER ROLE writer SET search_path = desirelines, extensions, public;
COMMENT ON ROLE writer IS 'postgres-writer Cloud Run service';

-- =============================================================================
-- apigateway service (read-only via ro_grp)
-- Secret: postgres-conn-apigateway
-- =============================================================================
CREATE ROLE apigateway WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ro_grp TO apigateway;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE apigateway IS 'apigateway Cloud Run service (read-only)';

-- =============================================================================
-- Reader (general read-only access via ro_grp)
-- Secret: postgres-conn-reader
-- =============================================================================
CREATE ROLE reader WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ro_grp TO reader;
ALTER ROLE reader SET search_path = desirelines, extensions, public;
COMMENT ON ROLE reader IS 'General read-only access';

-- =============================================================================
-- Admin access for manual operations (DDL via ddl_grp)
-- Secret: postgres-conn-admin
-- =============================================================================
CREATE ROLE admin WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ddl_grp TO admin;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
COMMENT ON ROLE admin IS 'Manual admin access (psql, debugging)';
