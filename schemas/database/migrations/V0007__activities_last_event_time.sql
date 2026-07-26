-- Activity Ordering: last_event_time fence token
-- Migration: V0007
-- Concern: Postgres is idempotent against redelivery of the *same* webhook
--          (ON CONFLICT), but has no defense against *reordering* of different
--          events for one activity. Pub/Sub is unordered + at-least-once, and
--          Strava emits multiple events per save, so closely-spaced events race
--          and the retry window can deliver an old event after a newer one.
--          Persist the newest applied webhook `event_time` per row so live
--          writes can reject stale/reordered events.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- COLUMNS
-- =============================================================================
-- Added to an existing table, so V0002's table-level grants already cover it
-- (no new GRANT needed). Nullable with NO default on purpose: NULL is a
-- meaningful state ("never touched by a fenced live write") that the write
-- guards treat as "always older", so the first post-migration write and every
-- backfill-only row are never blocked. A nullable ADD COLUMN with no default
-- is metadata-only (no table rewrite, no long lock).

ALTER TABLE desirelines.activities
    ADD COLUMN last_event_time BIGINT;

COMMENT ON COLUMN desirelines.activities.last_event_time IS
  'Unix seconds of the newest Strava webhook event_time applied to this row by '
  'a live write. NULL for rows never touched by a fenced live write (legacy '
  'rows and backfill-only rows). Live writes advance it and fence '
  'stale/reordered events on it; backfill does not advance it.';

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
