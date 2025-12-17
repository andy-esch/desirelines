-- Create login roles for local development
-- This script runs after the database is created but before Flyway migrations
-- Note: Role groups (desirelines_*_grp) are created by V0001 migration

-- For local dev, we create roles with simple passwords
-- Production uses separate secrets per role with strong passwords

-- =============================================================================
-- postgres-writer service (read/write via dml_grp)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'writer') THEN
        CREATE ROLE writer WITH LOGIN PASSWORD 'writer_local';
    END IF;
END $$;
COMMENT ON ROLE writer IS 'postgres-writer Cloud Run service (local dev)';

-- =============================================================================
-- apigateway service (read-only via ro_grp)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'apigateway') THEN
        CREATE ROLE apigateway WITH LOGIN PASSWORD 'apigateway_local';
    END IF;
END $$;
COMMENT ON ROLE apigateway IS 'apigateway Cloud Run service (local dev)';

-- =============================================================================
-- Flyway migrations (DDL via ddl_grp)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flyway') THEN
        CREATE ROLE flyway WITH LOGIN PASSWORD 'flyway_local';
    END IF;
END $$;
COMMENT ON ROLE flyway IS 'Flyway database migrations (local dev)';

-- =============================================================================
-- Admin access for manual operations (DDL via ddl_grp)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin WITH LOGIN PASSWORD 'admin_local';
    END IF;
END $$;
COMMENT ON ROLE admin IS 'Manual admin access (local dev)';

-- Note: Role group grants happen AFTER Flyway migrations create the groups
-- See: schemas/database/scripts/grant-role-memberships.sql
