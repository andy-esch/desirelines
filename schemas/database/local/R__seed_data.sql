-- Seed data for local development
-- This repeatable migration loads sample activities and shifts timestamps
-- to make the data appear recent.
--
-- To regenerate: export from prod/dev, paste INSERTs below, update NEWEST_IN_DUMP

-- =============================================================================
-- CONFIGURATION
-- =============================================================================

-- Set this to the most recent start_date_local in your dump
-- The shift will make this activity appear as "yesterday"
\set NEWEST_IN_DUMP '2024-11-15 08:30:00'

-- =============================================================================
-- SEED DATA
-- =============================================================================
-- Paste your INSERT statements here. Use ON CONFLICT to make idempotent.
--
-- Example format:
-- INSERT INTO desirelines.activities (
--     id, user_id, name, type, sport, start_date_local, year,
--     distance, moving_time, elapsed_time, total_elevation_gain,
--     average_speed, max_speed, average_heartrate, max_heartrate
-- ) VALUES
--     (1001, 'user123', 'Morning Run', 'Run', 'running', '2024-11-15 08:30:00', 2024, 5000, 1800, 1850, 50, 2.78, 3.5, 145, 165),
--     (1002, 'user123', 'Evening Ride', 'Ride', 'cycling', '2024-11-14 17:45:00', 2024, 25000, 3600, 3700, 200, 6.94, 12.0, NULL, NULL)
-- ON CONFLICT (id) DO NOTHING;

-- YOUR SEED DATA HERE:


-- =============================================================================
-- TIMESTAMP SHIFTING
-- =============================================================================
-- Shifts all seed data so the newest activity becomes "yesterday"
-- Also updates the year column to match the shifted date

DO $$
DECLARE
    newest_in_dump TIMESTAMP := :'NEWEST_IN_DUMP'::timestamp;
    target_date TIMESTAMP := (CURRENT_DATE - INTERVAL '1 day') + newest_in_dump::time;
    ts_shift INTERVAL := target_date - newest_in_dump;
BEGIN
    -- Only run if there's actually a shift needed (avoids unnecessary updates)
    IF ts_shift != INTERVAL '0' THEN
        RAISE NOTICE 'Shifting timestamps by %', ts_shift;

        UPDATE desirelines.activities
        SET
            start_date_local = start_date_local + ts_shift,
            year = EXTRACT(YEAR FROM start_date_local + ts_shift)::INTEGER,
            created_at = created_at + ts_shift,
            updated_at = CURRENT_TIMESTAMP
        WHERE id < 100000;  -- Convention: seed data uses IDs < 100000

        RAISE NOTICE 'Shifted % rows', ROW_COUNT;
    END IF;
END $$;
