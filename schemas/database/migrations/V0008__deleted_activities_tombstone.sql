-- Activity Deletion: tombstone table
-- Migration: V0008
-- Concern: A hard DELETE leaves no row, so a redelivered/reordered CREATE that
--          arrives after the delete resurrects an orphan activity that no longer
--          exists in Strava and is never cleaned up (silent, permanent
--          divergence). The event_time fence (V0007) can't help — there is no
--          row left to compare against. Record a durable tombstone carrying the
--          delete's webhook event_time so a later CREATE older than the delete
--          can be rejected. This is a lightweight marker, not an archive (unlike
--          BigQuery's deleted_activities, which snapshots the full activity).

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- TOMBSTONE TABLE
-- =============================================================================

CREATE TABLE desirelines.deleted_activities (
    id BIGINT PRIMARY KEY,                       -- Strava activity ID
    deletion_event_time BIGINT NOT NULL,         -- webhook event_time (unix s) of the delete
    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- when we processed it
    deletion_correlation_id VARCHAR(255)         -- trace id for the delete (nullable)
);

COMMENT ON TABLE desirelines.deleted_activities IS
  'Tombstones for deleted activities. A CREATE whose event_time is not strictly '
  'newer than deletion_event_time is rejected so a late/reordered CREATE cannot '
  'resurrect a deleted activity. Lightweight marker (id + delete metadata), not '
  'a full activity archive.';
COMMENT ON COLUMN desirelines.deleted_activities.deletion_event_time IS
  'Strava webhook event_time (unix seconds) of the DELETE. Fences later CREATEs.';

-- =============================================================================
-- GRANTS (for objects created in this migration)
-- =============================================================================

-- INSERT + UPDATE: the delete path upserts the tombstone (ON CONFLICT DO UPDATE
-- keeps the newest deletion_event_time). DELETE: reserved for future retention
-- cleanup. Matches the activities-table grant pattern (V0002).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.deleted_activities TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.deleted_activities TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
