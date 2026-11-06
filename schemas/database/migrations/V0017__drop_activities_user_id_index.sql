-- Drop the redundant activities user_id index
-- Migration: V0017
-- Concern: idx_activities_user_id (V0002) indexes user_id alone. V0016's
--          idx_activities_user_date (user_id, start_date_local DESC, id DESC)
--          leads with user_id, so it serves every lookup the old index did:
--          the planner switches to it with the same plans. The old index
--          only costs an extra index write on every activity insert, update
--          and delete.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- Fail fast instead of queueing behind a long transaction. DROP INDEX holds an
-- ACCESS EXCLUSIVE lock on activities only while it removes the catalog
-- entries; nothing is rebuilt. CONCURRENTLY can't run inside Flyway's
-- migration transaction, and isn't needed for so short a lock.
SET LOCAL lock_timeout = '5s';

-- =============================================================================
-- INDEXES
-- =============================================================================

DROP INDEX desirelines.idx_activities_user_id;
