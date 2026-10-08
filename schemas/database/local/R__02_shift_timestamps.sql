-- Shift seed data timestamps to appear recent
-- Runs AFTER R__01_seed_data.sql (Flyway runs repeatables alphabetically)
--
-- Makes the newest seed activity start yesterday, shifting all others by the
-- same amount. Seed rows are the mock athlete's (user_id '123456789'). The
-- shift is measured from the seed's current newest activity, so a re-run moves
-- nothing unless the data has gone stale.

DO $$
DECLARE
    newest TIMESTAMP;
    ts_shift INTERVAL;
    rows_updated INTEGER;
BEGIN
    SELECT max(start_date_local) INTO newest
    FROM desirelines.activities
    WHERE user_id = '123456789';

    IF newest IS NULL THEN
        RAISE NOTICE 'No seed data to shift';
        RETURN;
    END IF;

    ts_shift := ((CURRENT_DATE - INTERVAL '1 day') + newest::time) - newest;

    -- The shift is whole days (time of day is kept); none when already current.
    IF ts_shift <> INTERVAL '0' THEN
        RAISE NOTICE 'Shifting seed data timestamps by %', ts_shift;

        UPDATE desirelines.activities
        SET
            start_date_local = start_date_local + ts_shift,
            year = EXTRACT(YEAR FROM start_date_local + ts_shift)::INTEGER,
            created_at = created_at + ts_shift,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = '123456789';

        GET DIAGNOSTICS rows_updated = ROW_COUNT;
        RAISE NOTICE 'Shifted % rows', rows_updated;
    ELSE
        RAISE NOTICE 'Seed data already ends yesterday, no shift needed';
    END IF;
END $$;
