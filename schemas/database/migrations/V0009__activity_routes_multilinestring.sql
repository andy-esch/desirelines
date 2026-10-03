-- Activity Routes: store routes as MULTILINESTRING
-- Migration: V0009
-- Concern: An activity that is stopped, moved and restarted is one polyline from
--          Strava, so a single LINESTRING draws a false straight line between the
--          legs. A MULTILINESTRING lets each leg be its own part.
--
-- Writers need no lockstep change: PostGIS promotes a LineString inserted into a
-- MultiLineString column to a 1-part MultiLineString. Readers are unaffected:
-- ST_Simplify keeps every part, ST_AsMVTGeom/ST_AsMVT emit MultiLineString, and
-- ST_Intersects, ST_Centroid and the bbox functions accept it as-is.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- ROUTE GEOMETRY TYPE
-- =============================================================================

-- Rewrites the table and rebuilds idx_activity_routes_geom; grants are kept.
-- Existing rows become 1-part MultiLineStrings.
ALTER TABLE desirelines.activity_routes
    ALTER COLUMN route TYPE GEOMETRY(MULTILINESTRING, 4326)
    USING ST_Multi(route);

COMMENT ON COLUMN desirelines.activity_routes.route IS
  'Decoded Strava route. MultiLineString so an activity stopped and restarted '
  'somewhere else can be stored as separate legs; an unsplit route is 1 part.';

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
