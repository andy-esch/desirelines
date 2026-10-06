-- Activity Identity: every activity recorded
-- Migration: V0011
-- Concern: writers now look activities up through activity_external_ids, so an
--          activity without a mapping would be invisible to them. Writers set
--          the source and record the mapping on every write; this fills in rows
--          written before they did, then makes the source required.
--
-- Deploy only where writers that set `source` are already live. Under the NOT
-- NULL below an older writer fails every activity write and every delete (the
-- constraint is checked before ON CONFLICT), and Pub/Sub retries run out.

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- =============================================================================
-- HOLD WRITERS FOR THE MIGRATION
-- =============================================================================

-- Writers wait (reads continue) until the transaction commits, so none can
-- write between the backfill and the NOT NULL, or deadlock with the ALTERs
-- below. Fail fast rather than queue behind a long-running writer.
SET LOCAL lock_timeout = '5s';

LOCK TABLE desirelines.activities,
           desirelines.deleted_activities,
           desirelines.activity_external_ids
    IN EXCLUSIVE MODE;

-- =============================================================================
-- FILL IN ROWS WRITTEN BEFORE WRITERS RECORDED THEM
-- =============================================================================

-- Every activity and tombstone so far is a Strava one.
UPDATE desirelines.activities SET source = 'strava' WHERE source IS NULL;

UPDATE desirelines.deleted_activities SET source = 'strava' WHERE source IS NULL;

-- An activity's ID is still its Strava ID.
INSERT INTO desirelines.activity_external_ids (source, external_id, activity_id, external_owner_id)
SELECT source, id::text, id, user_id
FROM desirelines.activities
ON CONFLICT (source, external_id) DO NOTHING;

-- Writers cannot see an unmapped activity, so stop here rather than leave one.
DO $$
DECLARE
    unmapped bigint;
BEGIN
    SELECT count(*) INTO unmapped
    FROM desirelines.activities a
    WHERE NOT EXISTS (
        SELECT 1 FROM desirelines.activity_external_ids m WHERE m.activity_id = a.id
    );
    IF unmapped > 0 THEN
        RAISE EXCEPTION '% activities have no external-ID mapping', unmapped;
    END IF;
END $$;

-- =============================================================================
-- SOURCE REQUIRED
-- =============================================================================

-- Still no default: the application, not the schema, decides an activity's
-- source.
ALTER TABLE desirelines.activities ALTER COLUMN source SET NOT NULL;

ALTER TABLE desirelines.deleted_activities ALTER COLUMN source SET NOT NULL;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
