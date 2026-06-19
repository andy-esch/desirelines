-- Geospatial Data: Region Boundaries + Activity Route Tags
-- Migration: V0005
-- Concern: Add a source-agnostic boundary reference table and tag activity
--          routes with the region they fall in (for map labelling and
--          defaulting the routes-map viewport to the densest region).
--
-- The first boundary dataset is a US Census CBSA -> county cascade (a
-- placeholder). The table is intentionally generic (source + region_kind
-- columns, no dataset-specific structure) so a future global dataset can be
-- loaded into the same shape without a schema change.
--
-- Boundary geometries are loaded out-of-band by an ops script, not by the
-- application runtime. Tags on activity_routes are written by the
-- postgres-writer at ingestion (and backfilled once). See:
--   - schemas/database/README.md (migration/role conventions)
--   - V0003__add_activity_routes.sql (the activity_routes table this extends)

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- REGIONS REFERENCE TABLE
-- =============================================================================
-- Prerequisite: PostGIS extension is ensured by beforeMigrate.sql callback.
--
-- A lookup table of administrative/statistical boundaries. Routes reference a
-- region via a foreign key (activity_routes.region_id, below). A surrogate id
-- is used as the PK so the route reference is a single column; the dataset's own
-- composite identity (source + region_code) is kept as a UNIQUE natural key.
-- The table can be reloaded when the boundary dataset is swapped: DELETE the old
-- source's rows (ON DELETE SET NULL clears route references) and re-run tagging.

CREATE TABLE desirelines.regions (
    -- Surrogate key: lets activity_routes reference a region in one column.
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Natural identity (source-scoped). A region is uniquely identified by the
    -- dataset it came from plus that dataset's own code for it.
    source      VARCHAR(64)  NOT NULL,   -- dataset + vintage, e.g. 'census_cbsa_2023', 'census_county_2023'
    region_code VARCHAR(64)  NOT NULL,   -- the source's stable id, e.g. Census GEOID (CBSAFP / state+county FIPS)

    -- Classification + display
    region_kind VARCHAR(32)  NOT NULL,   -- 'cbsa_metro' | 'cbsa_micro' | 'county' (extensible for future datasets)
    region_name VARCHAR(255) NOT NULL,   -- human-readable name, e.g. 'Boston-Cambridge-Newton, MA-NH'

    -- Boundary geometry
    geom        GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,

    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (source, region_code)
);

COMMENT ON TABLE desirelines.regions IS
  'Source-agnostic boundary lookup for tagging activity routes by region. '
  'First dataset is a US Census CBSA + county placeholder; a global dataset '
  'can be loaded into the same shape later (new source/region_kind values).';
COMMENT ON COLUMN desirelines.regions.region_kind IS
  'Boundary class. Current values: cbsa_metro, cbsa_micro (both from the Census '
  'CBSA layer, split on its LSAD attribute: M1=metro, M2=micropolitan), county. '
  'Free-form so future datasets can introduce new kinds without a migration.';

-- Spatial index: drives the point-in-region join performed at tagging time.
CREATE INDEX idx_regions_geom ON desirelines.regions USING GIST (geom);

-- =============================================================================
-- ACTIVITY ROUTE REGION TAG
-- =============================================================================
-- Each route references the region it falls in. NULL means "untagged" (e.g. a
-- route outside the current dataset's coverage, like non-US activities under the
-- placeholder). ON DELETE SET NULL keeps reloading the regions table safe: drop
-- a source's rows and the references clear rather than blocking or cascading.
-- region_kind / region_name / source are read by joining to regions (small,
-- indexed table — no need to denormalize them onto every route).

ALTER TABLE desirelines.activity_routes
    ADD COLUMN region_id BIGINT REFERENCES desirelines.regions(id) ON DELETE SET NULL;

COMMENT ON COLUMN desirelines.activity_routes.region_id IS
  'FK to desirelines.regions. NULL = untagged / outside the active dataset '
  'coverage. Assigned at ingestion via a CBSA->county cascade.';

-- Supports the densest-region aggregation that picks the default map viewport:
--   SELECT region_id, COUNT(*) ... GROUP BY region_id ORDER BY 2 DESC
-- Partial index skips untagged routes.
CREATE INDEX idx_activity_routes_region
    ON desirelines.activity_routes (region_id)
    WHERE region_id IS NOT NULL;

-- =============================================================================
-- GRANTS (for objects created in this migration)
-- =============================================================================
-- Matches the V0002/V0003 pattern: explicit full DML for dml_grp, SELECT for
-- ro_grp. (V0001 default privileges already grant these for future tables; the
-- explicit grants are kept for clarity and parity with the other tables.)
-- In practice regions is loaded out-of-band by the ddl/owner role and only read
-- at runtime, but it is not locked down further so the grants stay consistent.
-- The new activity_routes columns are covered by V0003's table-level grants.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.regions TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.regions TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
