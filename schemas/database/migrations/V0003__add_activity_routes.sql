-- Geospatial Data: Activity Routes Table
-- Migration: V0003
-- Concern: Store decoded Strava polylines as PostGIS geometries

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- ACTIVITY ROUTES TABLE
-- =============================================================================
-- Prerequisite: PostGIS extension must already be installed.
-- Local/CI: pre-installed by postgis/postgis Docker image (public schema)
-- Production: manually installed by neondb_owner (extensions schema)
-- See: docs/guides/database-setup.md Section 3

-- Stores decoded detailed polylines from Strava activities.
-- Separate table keeps activities table lean; indoor/manual activities have no route.
CREATE TABLE desirelines.activity_routes (
    activity_id BIGINT PRIMARY KEY REFERENCES desirelines.activities(id) ON DELETE CASCADE,
    route GEOMETRY(LINESTRING, 4326) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE desirelines.activity_routes IS 'Decoded Strava polylines stored as PostGIS geometries';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Spatial index for geographic queries (bounding box, proximity, etc.)
CREATE INDEX idx_activity_routes_geom ON desirelines.activity_routes USING GIST (route);

-- =============================================================================
-- GRANTS (for objects created in this migration)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.activity_routes TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.activity_routes TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

RESET ROLE;
