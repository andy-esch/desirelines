-- Schema Documentation: start_date_local timezone semantics
-- Migration: V0004
-- Concern: Persist the "no UTC conversion" invariant for start_date_local
--          at the schema level so any tool reading the schema (psql \d+,
--          pgAdmin, schema-aware introspection in BI tools) sees the rule.
--
-- The invariant is currently documented only in Go source comments
-- (packages/apigateway/adapters/postgres/activities.go package doc).
-- A schema-level COMMENT survives Go-side refactors and is visible to
-- any DB-introspecting tool, reinforcing the invariant where it matters
-- most: at the data layer.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- COMMENT ON COLUMN
-- =============================================================================

COMMENT ON COLUMN desirelines.activities.start_date_local IS
  'Activity start time in athlete''s local timezone, exactly as Strava provides. '
  'Type is TIMESTAMP WITHOUT TIME ZONE: do NOT convert to UTC on read or write — '
  'that would misrepresent the user''s experienced date for late-night activities '
  'outside UTC. All date-bucket queries (daily/yearly summaries) extract date '
  'from this column directly via ::date, which is correct because TIMESTAMP '
  'without timezone is unaffected by session timezone.';

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
