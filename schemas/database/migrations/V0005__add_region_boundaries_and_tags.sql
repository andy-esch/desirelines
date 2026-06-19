-- Geospatial Data: Region Boundaries + Activity Route Tags
-- Migration: V0005
-- Concern: Add a source-agnostic boundary reference table and tag activities
--          with the region(s) they fall in (many-to-many — a route can cross
--          several), for map labelling, region filtering, and defaulting the
--          routes-map viewport to the densest region.
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
-- A lookup table of administrative/statistical boundaries. Activities reference
-- regions through the activity_regions junction (below). A surrogate id is the
-- PK so the junction's FK is a single column; the dataset's own composite
-- identity (source + region_code) is kept as a UNIQUE natural key. The table can
-- be reloaded when the boundary dataset is swapped: DELETE the old source's rows
-- (activity_regions FK is ON DELETE CASCADE, so its tag rows drop with them) and
-- re-run tagging.

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
  'Boundary class. Current values: global (the builtin "earth" fallback below); '
  'cbsa_metro, cbsa_micro (both from the Census CBSA layer, split on its LSAD '
  'attribute: M1=metro, M2=micropolitan); county. Free-form so future datasets '
  'can introduce new kinds without a migration.';

-- Spatial index: drives the point-in-region join performed at tagging time.
CREATE INDEX idx_regions_geom ON desirelines.regions USING GIST (geom);

-- Builtin "earth" fallback region. An activity with real-world geometry that
-- matches no specific boundary (e.g. it's outside the current dataset's coverage,
-- like a non-US ride under the US placeholder) is tagged here instead of being
-- left untagged — so every geometry-bearing activity belongs to >=1 region, and
-- "zero activity_regions rows" cleanly means "no real geography" (indoor/virtual).
-- This row is EXCLUDED from the spatial join at tagging time (region_kind
-- <> 'global') and assigned only as a fallback when no specific region matches.
-- Its geom is the whole-world extent so region-summary's ST_Extent gives a global
-- viewport. Seeded here (not via the Census loader) because it's intrinsic and
-- dataset-independent; the loader's --replace only touches census_* sources.
INSERT INTO desirelines.regions (source, region_code, region_kind, region_name, geom)
VALUES (
    'builtin',
    'earth',
    'global',
    'Earth (all other regions)',
    ST_SetSRID(
        ST_GeomFromText('MULTIPOLYGON(((-180 -90, 180 -90, 180 90, -180 90, -180 -90)))'),
        4326
    )
);

-- =============================================================================
-- ACTIVITY <-> REGION TAGS (many-to-many)
-- =============================================================================
-- An activity can fall in more than one region (a long route crosses several
-- counties, and possibly more than one CBSA), so the tag is a junction table
-- rather than a single column. The PK (activity_id, region_id) enforces
-- UNIQUE(activity_id, region_id). This shape is agnostic to how matches are
-- produced — a single "best" region or every intersecting region both fit — so
-- the tagging operation (point vs full linestring, cascade vs tag-all) can be
-- decided/changed later without a schema change.
--
-- Keyed on activity_id (not the route) so a routeless/virtual activity could be
-- tagged from point geometry later. ON DELETE CASCADE on both sides: dropping an
-- activity, or reloading the regions table (DELETE a source's rows), clears the
-- now-stale tags — a re-tag restores them. An activity with no match simply has
-- no rows here (the "untagged" state).

CREATE TABLE desirelines.activity_regions (
    activity_id BIGINT NOT NULL REFERENCES desirelines.activities(id) ON DELETE CASCADE,
    region_id   BIGINT NOT NULL REFERENCES desirelines.regions(id)   ON DELETE CASCADE,

    PRIMARY KEY (activity_id, region_id)
);

COMMENT ON TABLE desirelines.activity_regions IS
  'Many-to-many tags linking activities to the regions they fall in (a route may '
  'cross several). Assigned from route/point geometry; an activity with no match '
  'has no rows here.';

-- Reverse-direction lookups + the densest-region aggregation that picks the
-- default map viewport: SELECT region_id, COUNT(*) ... GROUP BY region_id.
-- (The forward direction, activity_id -> regions, is served by the PK.)
CREATE INDEX idx_activity_regions_region ON desirelines.activity_regions (region_id);

-- =============================================================================
-- GRANTS (for objects created in this migration)
-- =============================================================================
-- Matches the V0002/V0003 pattern: explicit full DML for dml_grp, SELECT for
-- ro_grp. (V0001 default privileges already grant these for future tables; the
-- explicit grants are kept for clarity and parity with the other tables.)
-- regions is loaded out-of-band by the ddl/owner role and only read at runtime;
-- activity_regions is written by the postgres-writer at tagging time. Neither is
-- locked down further, so the grants stay consistent across tables.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.regions TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.regions TO desirelines_ro_grp;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.activity_regions TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.activity_regions TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
