-- Activity Identity: desirelines activity IDs
-- Migration: V0012
-- Concern: every activity is still keyed by the Strava ID it was ingested
--          with. This gives each one a desirelines ID, numbered from
--          1,000,000 in start-date order, so Strava's IDs live only in
--          activity_external_ids.
--
-- Writers and source links already resolve activities through the mapping, so
-- the renumbering is invisible to them. Routes, region tags and mappings follow
-- through their ON UPDATE CASCADE foreign keys; tombstones stay keyed by the
-- Strava ID. New activities keep taking their Strava ID until IDs are allocated
-- from the sequence; rekey_adopted_activities() renumbers any such stragglers
-- (it is idempotent). Until then, a Strava ID from the new range (2009-2010
-- activities) would collide with an existing activity: see the "Known gap"
-- note on the writers' mapping claim (stravapipe adapters/postgres).

-- =============================================================================
-- SET ROLE FOR CONSISTENT OWNERSHIP
-- =============================================================================

SET ROLE desirelines_ddl_grp;

-- Fail fast rather than queue behind a long-running writer.
SET LOCAL lock_timeout = '5s';

-- =============================================================================
-- ID RANGE
-- =============================================================================

-- desirelines IDs start at 1,000,000: sequential and short, never mistaken for a
-- year or a count. Strava's IDs have been 9+ digits since about 2013, but older
-- ones can be 7 digits, so the two ranges can overlap: activities keyed by their
-- Strava ID are renumbered in two steps below.
-- ALTER SEQUENCE locks only the sequence, not the activities table.
ALTER SEQUENCE desirelines.activities_id_seq START WITH 1000000 RESTART WITH 1000000;

-- Every activity is still keyed by its Strava ID ("adopted"); anything else would
-- shift the new range, so stop instead.
DO $$
DECLARE
    other bigint;
BEGIN
    SELECT count(*) INTO other
    FROM desirelines.activities a
    WHERE NOT EXISTS (
        SELECT 1 FROM desirelines.activity_external_ids m
        WHERE m.activity_id = a.id AND m.source = 'strava' AND m.external_id = a.id::text
    );
    IF other > 0 THEN
        RAISE EXCEPTION '% activities are not keyed by their Strava ID', other;
    END IF;
END $$;

-- =============================================================================
-- RENUMBERING
-- =============================================================================

-- Gives every activity still keyed by its Strava ID ("adopted": its ID equals its
-- strava mapping's external_id) the next desirelines IDs, in start-date order,
-- and returns how many it renumbered. Holds writers for its duration (reads
-- continue), locking tables in the writers' order: mapping before activity. Never
-- reuses an ID: it numbers past both the sequence and the highest existing
-- desirelines ID, and moves the sequence past what it assigns. Anything that
-- allocates from the sequence must call nextval() inside a statement on these
-- tables, so these locks hold it off until the sequence has moved.
CREATE FUNCTION desirelines.rekey_adopted_activities() RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    id_sequence    text := pg_get_serial_sequence('desirelines.activities', 'id');
    last_allocated bigint;
    base           bigint;
    renumbered     bigint;
BEGIN
    LOCK TABLE desirelines.activity_external_ids,
               desirelines.activities,
               desirelines.activity_routes,
               desirelines.activity_regions
        IN EXCLUSIVE MODE;

    EXECUTE format(
        'SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM %s',
        id_sequence
    ) INTO last_allocated;

    -- Number past the sequence and every activity that already has a
    -- desirelines ID.
    SELECT GREATEST(last_allocated, COALESCE(max(a.id), 0))
      INTO base
      FROM desirelines.activities a
     WHERE NOT EXISTS (
               SELECT 1 FROM desirelines.activity_external_ids m
                WHERE m.activity_id = a.id AND m.source = 'strava'
                  AND m.external_id = a.id::text
           );

    -- Two steps, through negative IDs, so a new ID can never collide with an
    -- adopted ID that has not moved yet (old Strava IDs can be 7 digits).
    WITH plan AS (
        SELECT a.id AS old_id,
               row_number() OVER (ORDER BY a.start_date_local, a.id) AS position
        FROM desirelines.activities a
        JOIN desirelines.activity_external_ids m
          ON m.activity_id = a.id AND m.source = 'strava'
         AND m.external_id = a.id::text
    )
    UPDATE desirelines.activities a
       SET id = -(base + plan.position)
      FROM plan
     WHERE a.id = plan.old_id;
    GET DIAGNOSTICS renumbered = ROW_COUNT;

    IF renumbered > 0 THEN
        UPDATE desirelines.activities SET id = -id WHERE id < 0;
        PERFORM setval(id_sequence, base + renumbered);
    END IF;
    RETURN renumbered;
END;
$$;

COMMENT ON FUNCTION desirelines.rekey_adopted_activities() IS
  'Renumbers activities still keyed by their Strava ID onto desirelines IDs, in '
  'start-date order; idempotent. Returns how many it renumbered.';

-- Writers hold UPDATE on activities; only migrations may renumber.
REVOKE ALL ON FUNCTION desirelines.rekey_adopted_activities() FROM PUBLIC;

SELECT desirelines.rekey_adopted_activities();

-- Every activity now has a desirelines ID; stop rather than leave one behind.
DO $$
DECLARE
    adopted bigint;
BEGIN
    SELECT count(*) INTO adopted
    FROM desirelines.activities a
    JOIN desirelines.activity_external_ids m
      ON m.activity_id = a.id AND m.source = 'strava' AND m.external_id = a.id::text;
    IF adopted > 0 THEN
        RAISE EXCEPTION '% activities are still keyed by their Strava ID', adopted;
    END IF;
END $$;

-- =============================================================================
-- RESET ROLE
-- =============================================================================

-- Reset to original user so Flyway can update flyway_schema_history
RESET ROLE;
