-- Activity Identity: sweep activities ingested with adopted Strava IDs since
-- V0012, before the writers switch to sequence allocation. Existing desirelines
-- IDs remain unchanged. The function locks out writers and advances the
-- sequence past every ID it assigns; the count is emitted in the migration log.

SET ROLE desirelines_ddl_grp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    renumbered bigint;
BEGIN
    SELECT desirelines.rekey_adopted_activities() INTO renumbered;
    RAISE NOTICE 'Re-keyed % adopted activity ID stragglers', renumbered;
END $$;

RESET ROLE;
