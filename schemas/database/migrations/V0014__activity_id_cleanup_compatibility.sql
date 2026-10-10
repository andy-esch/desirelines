-- Activity identity cleanup: compatibility stage
--
-- Migrations deploy before writer images. Keep the legacy tombstone primary key
-- and BY DEFAULT activity identity for this release, so the previous writer
-- still works. The new writer names tombstones by (source, external_id) and
-- explicitly overrides the activity identity with its mapping's allocated ID.
-- Only after those writers have rolled out and old executions have drained may
-- a later migration drop the legacy tombstone column/bridge and tighten the
-- activity identity to ALWAYS.

SET ROLE desirelines_ddl_grp;
SET LOCAL lock_timeout = '5s';

-- DROP EXPRESSION preserves existing external IDs. The bridge below fills the
-- missing spelling on INSERT, supporting both old and new writer statements.
ALTER TABLE desirelines.deleted_activities
    ALTER COLUMN external_id DROP EXPRESSION,
    ALTER COLUMN external_id SET NOT NULL,
    ADD CONSTRAINT deleted_activities_legacy_id_matches_external_id
        CHECK (id::text = external_id);

CREATE FUNCTION desirelines.bridge_legacy_tombstone_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.external_id IS NULL THEN
        NEW.external_id := NEW.id::text;
    ELSIF NEW.id IS NULL THEN
        NEW.id := NEW.external_id::bigint;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER bridge_legacy_tombstone_id
    BEFORE INSERT ON desirelines.deleted_activities
    FOR EACH ROW EXECUTE FUNCTION desirelines.bridge_legacy_tombstone_id();

COMMENT ON FUNCTION desirelines.bridge_legacy_tombstone_id() IS
    'Temporary compatibility bridge for old id-keyed and new external-ID-keyed '
    'tombstone inserts. Remove with the legacy id column after writer rollout. '
    'Until then external IDs must remain canonical bigint strings and the '
    'legacy primary key still prevents equal IDs across sources.';

REVOKE ALL ON FUNCTION desirelines.bridge_legacy_tombstone_id() FROM PUBLIC;

RESET ROLE;
