-- Final activity-ID cleanup. Requires V0014-compatible writer/backfill images
-- in every environment and all pre-compatibility executions drained.
-- After this migration, rolling back to a legacy writer is incompatible.

SET ROLE desirelines_ddl_grp;
SET LOCAL lock_timeout = '5s';

-- Hold allocation/writes in the application's lock order while checking the
-- last adopted IDs and changing identity enforcement. Do not silently sweep:
-- the equality check is a conservative transition heuristic, not provenance.
LOCK TABLE desirelines.activity_external_ids, desirelines.activities
    IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    adopted bigint;
BEGIN
    SELECT count(*) INTO adopted
    FROM desirelines.activities a
    JOIN desirelines.activity_external_ids m ON m.activity_id = a.id
    WHERE m.source = 'strava' AND m.external_id = a.id::text;
    IF adopted > 0 THEN
        RAISE EXCEPTION 'Activity-ID cleanup requires zero adopted IDs; found %', adopted;
    END IF;
END $$;

-- Keep the source key and every deletion fence/metadata value in place.
DROP TRIGGER bridge_legacy_tombstone_id ON desirelines.deleted_activities;
DROP FUNCTION desirelines.bridge_legacy_tombstone_id();
ALTER TABLE desirelines.deleted_activities
    DROP CONSTRAINT deleted_activities_legacy_id_matches_external_id,
    DROP COLUMN id,
    ADD CONSTRAINT deleted_activities_pkey
        PRIMARY KEY USING INDEX deleted_activities_source_external_id_key;

COMMENT ON TABLE desirelines.deleted_activities IS
    'Deletion fences keyed by (source, external_id), independent of activity '
    'IDs and their removed mappings. Late CREATEs are rejected unless their '
    'event_time is strictly newer than deletion_event_time.';

-- Mapping-first writes intentionally use OVERRIDING SYSTEM VALUE to insert
-- the ID allocated by their mapping CTE. No source ID belongs in this column.
ALTER TABLE desirelines.activities ALTER COLUMN id SET GENERATED ALWAYS;
DROP FUNCTION desirelines.rekey_adopted_activities();

RESET ROLE;
