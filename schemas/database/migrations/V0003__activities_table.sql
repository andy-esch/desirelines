-- Business Data: Activities Table
-- Migration: V0003
-- Concern: Core activities table with indexes and grants

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

-- All objects created as ddl_grp for consistent ownership
-- This allows default privileges to work correctly
SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- ACTIVITIES TABLE
-- =============================================================================

-- Primary entity: Strava activities synced via webhooks
CREATE TABLE desirelines.activities (
    -- Identity
    id BIGINT PRIMARY KEY,                    -- Strava activity ID
    user_id VARCHAR(255) NOT NULL,            -- User identifier

    -- Activity metadata
    name VARCHAR(500),                        -- Activity name/title
    type VARCHAR(50) NOT NULL,                -- Strava activity type (Run, Ride, etc.)
    sport VARCHAR(50) NOT NULL,               -- Categorized sport (running, cycling, etc.)
    start_date_local TIMESTAMP NOT NULL,      -- Local start time
    year INTEGER NOT NULL,                    -- Extracted year for filtering

    -- Metrics
    distance FLOAT NOT NULL,                  -- Distance in meters
    moving_time INTEGER NOT NULL,             -- Moving time in seconds
    elapsed_time INTEGER NOT NULL,            -- Total elapsed time in seconds
    total_elevation_gain FLOAT,               -- Elevation gain in meters
    average_speed FLOAT,                      -- Average speed in m/s
    max_speed FLOAT,                          -- Max speed in m/s
    average_heartrate FLOAT,                  -- Average heart rate (bpm)
    max_heartrate FLOAT,                      -- Max heart rate (bpm)

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE desirelines.activities IS 'Strava activities synced from webhooks';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Sport + date: Most common query pattern (chart data by sport/year)
-- Used by: GET /api/activities?sport=running&year=2024
CREATE INDEX idx_activities_sport_date
    ON desirelines.activities(sport, start_date_local DESC);

-- Year: Year-based filtering and aggregations
CREATE INDEX idx_activities_year
    ON desirelines.activities(year);

-- User: Per-user activity lookups (multi-user support)
CREATE INDEX idx_activities_user_id
    ON desirelines.activities(user_id);

-- =============================================================================
-- GRANTS (for objects created in this migration)
-- =============================================================================

-- Default privileges only apply to FUTURE objects, so we must explicitly
-- grant on tables created in this migration

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE desirelines.activities TO desirelines_dml_grp;
GRANT SELECT ON TABLE desirelines.activities TO desirelines_ro_grp;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
