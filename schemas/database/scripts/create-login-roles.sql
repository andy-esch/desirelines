-- Create login roles for Desirelines services
-- Run manually in Neon console (dev and prod separately)
-- These are LOGIN roles (can authenticate), unlike role GROUPS (NOLOGIN)

-- =============================================================================
-- postgres-writer service (read/write via dml_grp)
-- =============================================================================
CREATE ROLE writer WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_dml_grp TO writer;
ALTER ROLE writer SET search_path = desirelines, extensions, public;
COMMENT ON ROLE writer IS 'postgres-writer Cloud Run service';

-- =============================================================================
-- apigateway service (read-only via ro_grp)
-- =============================================================================
CREATE ROLE apigateway WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ro_grp TO apigateway;
ALTER ROLE apigateway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE apigateway IS 'apigateway Cloud Run service (read-only)';

-- =============================================================================
-- Flyway migrations (DDL via ddl_grp)
-- =============================================================================
CREATE ROLE flyway WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ddl_grp TO flyway;
ALTER ROLE flyway SET search_path = desirelines, extensions, public;
COMMENT ON ROLE flyway IS 'Flyway database migrations';

-- =============================================================================
-- Admin access for manual operations (DDL via ddl_grp)
-- =============================================================================
CREATE ROLE admin WITH LOGIN PASSWORD 'GENERATE_SECURE_32CHAR_PASSWORD';
GRANT desirelines_ddl_grp TO admin;
ALTER ROLE admin SET search_path = desirelines, extensions, public;
COMMENT ON ROLE admin IS 'Manual admin access (psql, debugging)';
