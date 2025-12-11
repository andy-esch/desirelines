-- Performance indexes for common query patterns
-- Migration: V0002
-- Description: Add indexes for frequent queries

-- =============================================================================
-- SWITCH TO DDL GROUP ROLE
-- =============================================================================

-- All DDL operations should be performed as ddl_grp to maintain consistent ownership
SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- CREATE INDEXES
-- =============================================================================

-- Index for sport + date queries (most common: chart data by sport/year)
-- Used by: GET /api/activities?sport=running&year=2024
CREATE INDEX IF NOT EXISTS idx_activities_sport_date
    ON desirelines.activities(sport, start_date_local DESC);

-- Index for year-based queries
-- Used by: Year filtering and aggregations
CREATE INDEX IF NOT EXISTS idx_activities_year
    ON desirelines.activities(year);

-- Index for user-based queries (future multi-user support)
-- Used by: Per-user activity lookups
CREATE INDEX IF NOT EXISTS idx_activities_user_id
    ON desirelines.activities(user_id);

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original connecting user so Flyway can update its tracking table
RESET ROLE;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

-- Summary:
-- ✓ Created 3 indexes on desirelines.activities
-- ✓ All indexes owned by desirelines_ddl_grp
-- ✓ Default privileges automatically grant access to dml_grp and ro_grp
