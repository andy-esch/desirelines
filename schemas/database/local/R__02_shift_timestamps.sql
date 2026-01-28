-- Shift seed data timestamps to appear recent
-- Runs AFTER R__01_seed_data.sql (Flyway runs repeatables alphabetically)
--
-- This makes the newest activity appear as "yesterday", shifting all others
-- proportionally. Only affects seed data (id < 100000 convention).

DO $$
DECLARE
    -- Must match the newest start_date_local in R__01_seed_data.sql
    newest_in_dump TIMESTAMP := '2026-01-17 06:55:14'::timestamp;
    target_date TIMESTAMP := (CURRENT_DATE - INTERVAL '1 day') + newest_in_dump::time;
    ts_shift INTERVAL := target_date - newest_in_dump;
    rows_updated INTEGER;
BEGIN
    -- Only shift if needed (data is stale by more than 1 day)
    IF ts_shift > INTERVAL '1 day' OR ts_shift < INTERVAL '-1 day' THEN
        RAISE NOTICE 'Shifting seed data timestamps by %', ts_shift;

        UPDATE desirelines.activities
        SET
            start_date_local = start_date_local + ts_shift,
            year = EXTRACT(YEAR FROM start_date_local + ts_shift)::INTEGER,
            created_at = created_at + ts_shift,
            updated_at = CURRENT_TIMESTAMP
        WHERE id < 100000;

        GET DIAGNOSTICS rows_updated = ROW_COUNT;
        RAISE NOTICE 'Shifted % rows', rows_updated;
    ELSE
        RAISE NOTICE 'Seed data is recent (within 1 day), no shift needed';
    END IF;
END $$;
