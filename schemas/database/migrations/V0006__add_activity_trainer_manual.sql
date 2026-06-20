-- Activity Classification: trainer / manual flags
-- Migration: V0006
-- Concern: Persist Strava's `trainer` (recorded on an indoor trainer) and
--          `manual` (manually entered, no device/GPS) booleans so the routes-map
--          feature can classify virtual/indoor activities into the complementary
--          (non-map) view instead of tagging them to a real region. Today the
--          Postgres write drops both flags.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- COLUMNS
-- =============================================================================
-- Added to an existing table, so V0002's table-level grants already cover them
-- (no new GRANT needed). DEFAULT FALSE backfills existing rows; the writer and
-- the BigQuery backfill populate the real values.

ALTER TABLE desirelines.activities
    ADD COLUMN trainer BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN manual  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN desirelines.activities.trainer IS
  'Strava "trainer" flag: recorded on an indoor trainer. With `manual` and '
  'type LIKE ''Virtual%'' this identifies non-geographic activities, which are '
  'shown in the routes-map complementary view rather than tagged to a region.';
COMMENT ON COLUMN desirelines.activities.manual IS
  'Strava "manual" flag: manually entered, no device/GPS.';

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
