-- Activity list ordering index
-- Migration: V0016
-- Concern: ListActivities (packages/apigateway/adapters/postgres/activities.go)
--          pages an athlete's activities with keyset pagination ordered by
--          (start_date_local DESC, id DESC). No index supplied rows in that
--          order, so every page read all of the athlete's rows through
--          idx_activities_user_id and sorted them before the LIMIT: the cost
--          grew with their whole history, not the page size.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- Fail fast instead of queueing behind a long transaction. CREATE INDEX blocks
-- writes to activities while it builds, which takes well under a second at
-- today's row counts.
SET LOCAL lock_timeout = '5s';

-- =============================================================================
-- INDEXES
-- =============================================================================
-- Matches ListActivities' filter and order exactly, so a page is an index scan
-- that stops after LIMIT rows. A plain index on an existing table needs no new
-- GRANT.

CREATE INDEX idx_activities_user_date
    ON desirelines.activities (user_id, start_date_local DESC, id DESC);

COMMENT ON INDEX desirelines.idx_activities_user_date IS
    'Serves ListActivities keyset pagination: WHERE user_id = ? ORDER BY '
    'start_date_local DESC, id DESC. Without it every page sorts the user''s '
    'whole history.';
