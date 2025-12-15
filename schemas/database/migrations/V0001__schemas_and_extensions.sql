-- Infrastructure: Schemas and Extensions
-- Migration: V0001
-- Concern: Database namespace setup and extension installation

-- =============================================================================
-- SCHEMAS
-- =============================================================================

-- Desirelines application schema: All business logic tables
CREATE SCHEMA IF NOT EXISTS desirelines;
COMMENT ON SCHEMA desirelines IS 'Desirelines application tables and business logic';

-- Extensions schema: PostGIS and other extensions isolated from app namespace
CREATE SCHEMA IF NOT EXISTS extensions;
COMMENT ON SCHEMA extensions IS 'PostgreSQL extensions (PostGIS, etc.)';

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

-- PostGIS: Geospatial extension for map-based features
-- Installed in extensions schema to keep functions out of app namespace
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
