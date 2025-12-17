//go:build integration

package postgres_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
)

// TestIntegration_ActivityRepository runs integration tests against a real PostgreSQL database.
// To run: go test -tags=integration -v ./adapters/postgres/...
//
// Requires:
// - POSTGRES_CONNECTION_STRING env var set to a valid connection string
// - Database with desirelines schema and activities table (run Flyway migrations first)
//
// Example setup:
//   make start-frontend  # Starts postgres and runs migrations
//   export POSTGRES_CONNECTION_STRING="postgresql://desirelines:local_dev_password@localhost:15430/desirelines_local?application_name=integration-test"
//   go test -tags=integration -v ./adapters/postgres/...

func TestIntegration_ActivityRepository(t *testing.T) {
	connString := os.Getenv("POSTGRES_CONNECTION_STRING")
	if connString == "" {
		t.Skip("POSTGRES_CONNECTION_STRING not set, skipping integration tests")
	}

	ctx := context.Background()

	// Create a direct pool for test data setup (bypassing our Pool wrapper validation)
	setupPool, err := pgxpool.New(ctx, connString)
	if err != nil {
		t.Fatalf("failed to create setup pool: %v", err)
	}
	defer setupPool.Close()

	// Clean up test data before and after
	cleanupTestData(t, setupPool)
	t.Cleanup(func() { cleanupTestData(t, setupPool) })

	// Insert test data
	insertTestData(t, setupPool)

	// Create the repository using our Pool wrapper
	pool, err := postgres.NewPool(ctx)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	repo := postgres.NewActivityRepository(pool)
	defer repo.Close()

	t.Run("Ping", func(t *testing.T) {
		if err := repo.Ping(ctx); err != nil {
			t.Errorf("Ping failed: %v", err)
		}
	})

	t.Run("GetSportMetrics", func(t *testing.T) {
		// Pass Strava sport types that map to "cycling" category
		metrics, err := repo.GetSportMetrics(ctx, 2024, []string{"Ride", "VirtualRide"})
		if err != nil {
			t.Fatalf("GetSportMetrics failed: %v", err)
		}

		if len(metrics.Timeseries) != 2 {
			t.Errorf("expected 2 timeseries entries, got %d", len(metrics.Timeseries))
		}

		// First entry should be Jan 15
		if metrics.Timeseries[0].Date != "2024-01-15" {
			t.Errorf("expected first date 2024-01-15, got %s", metrics.Timeseries[0].Date)
		}

		// Values should be cumulative
		// Jan 15: 10000m distance
		// Jan 16: 10000 + 15000 = 25000m cumulative
		if metrics.Timeseries[1].Distance == nil || *metrics.Timeseries[1].Distance != 25000 {
			t.Errorf("expected cumulative distance 25000, got %v", metrics.Timeseries[1].Distance)
		}
	})

	t.Run("GetSportMetrics_NoResults", func(t *testing.T) {
		metrics, err := repo.GetSportMetrics(ctx, 2024, []string{"NonexistentSport"})
		if err != nil {
			t.Fatalf("GetSportMetrics failed: %v", err)
		}

		if len(metrics.Timeseries) != 0 {
			t.Errorf("expected 0 timeseries entries for nonexistent sport, got %d", len(metrics.Timeseries))
		}
	})

	t.Run("GetDailySummary", func(t *testing.T) {
		// Pass Strava sport types that map to "cycling" category
		summary, err := repo.GetDailySummary(ctx, 2024, []string{"Ride", "VirtualRide"})
		if err != nil {
			t.Fatalf("GetDailySummary failed: %v", err)
		}

		if len(summary) != 2 {
			t.Errorf("expected 2 daily entries, got %d", len(summary))
		}

		// Check Jan 15 entry
		jan15 := summary["2024-01-15"]
		if jan15 == nil {
			t.Fatal("expected entry for 2024-01-15")
		}

		if jan15.DistanceMeters == nil || *jan15.DistanceMeters != 10000 {
			t.Errorf("expected distance 10000, got %v", jan15.DistanceMeters)
		}

		if jan15.Activities != 1 {
			t.Errorf("expected 1 activity, got %d", jan15.Activities)
		}

		if len(jan15.ActivityIDs) != 1 || jan15.ActivityIDs[0] != 1001 {
			t.Errorf("expected activity ID [1001], got %v", jan15.ActivityIDs)
		}
	})

	t.Run("GetYearMetadata", func(t *testing.T) {
		metadata, err := repo.GetYearMetadata(ctx, 2024)
		if err != nil {
			t.Fatalf("GetYearMetadata failed: %v", err)
		}

		if metadata.Year != 2024 {
			t.Errorf("expected year 2024, got %d", metadata.Year)
		}

		// Should have both Ride and Run (raw Strava sport types)
		if len(metadata.Sports) != 2 {
			t.Errorf("expected 2 sports, got %d: %v", len(metadata.Sports), metadata.Sports)
		}

		// Check Ride totals (raw Strava sport_type)
		rideTotals := metadata.Totals["Ride"]
		if rideTotals == nil {
			t.Fatal("expected Ride totals")
		}

		// 10000 + 15000 = 25000 total distance
		if rideTotals.DistanceMeters == nil || *rideTotals.DistanceMeters != 25000 {
			t.Errorf("expected Ride total distance 25000, got %v", rideTotals.DistanceMeters)
		}

		if rideTotals.Activities != 2 {
			t.Errorf("expected 2 Ride activities, got %d", rideTotals.Activities)
		}

		// Check Run totals (raw Strava sport_type)
		runTotals := metadata.Totals["Run"]
		if runTotals == nil {
			t.Fatal("expected Run totals")
		}

		if runTotals.Activities != 1 {
			t.Errorf("expected 1 Run activity, got %d", runTotals.Activities)
		}
	})

	t.Run("GetYearMetadata_NoResults", func(t *testing.T) {
		metadata, err := repo.GetYearMetadata(ctx, 1999)
		if err != nil {
			t.Fatalf("GetYearMetadata failed: %v", err)
		}

		if len(metadata.Sports) != 0 {
			t.Errorf("expected 0 sports for year with no data, got %d", len(metadata.Sports))
		}
	})
}

// cleanupTestData removes test data from the database
func cleanupTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	// Delete test activities (IDs 1001-1003)
	_, err := pool.Exec(ctx, `
		DELETE FROM desirelines.activities
		WHERE id IN (1001, 1002, 1003)
	`)
	if err != nil {
		t.Logf("cleanup warning: %v", err)
	}
}

// insertTestData inserts test activities for integration tests
func insertTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	// Test data:
	// - 2 cycling activities: Jan 15 (10km), Jan 16 (15km)
	// - 1 running activity: Jan 15 (5km)
	testActivities := []struct {
		id             int64
		userID         string
		name           string
		activityType   string
		sport          string
		startDateLocal time.Time
		year           int
		distance       float64
		movingTime     int
		elapsedTime    int
		elevationGain  float64
	}{
		{
			id:             1001,
			userID:         "test-user",
			name:           "Morning Ride",
			activityType:   "Ride",
			sport:          "Ride", // Raw Strava sport_type
			startDateLocal: time.Date(2024, 1, 15, 8, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       10000, // 10km in meters
			movingTime:     1800,  // 30 minutes in seconds
			elapsedTime:    2000,
			elevationGain:  100,
		},
		{
			id:             1002,
			userID:         "test-user",
			name:           "Afternoon Ride",
			activityType:   "Ride",
			sport:          "Ride", // Raw Strava sport_type
			startDateLocal: time.Date(2024, 1, 16, 14, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       15000, // 15km in meters
			movingTime:     2700,  // 45 minutes in seconds
			elapsedTime:    3000,
			elevationGain:  200,
		},
		{
			id:             1003,
			userID:         "test-user",
			name:           "Morning Run",
			activityType:   "Run",
			sport:          "Run", // Raw Strava sport_type
			startDateLocal: time.Date(2024, 1, 15, 7, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       5000, // 5km in meters
			movingTime:     1500, // 25 minutes in seconds
			elapsedTime:    1600,
			elevationGain:  50,
		},
	}

	for _, a := range testActivities {
		_, err := pool.Exec(ctx, `
			INSERT INTO desirelines.activities (
				id, user_id, name, type, sport, start_date_local, year,
				distance, moving_time, elapsed_time, total_elevation_gain
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (id) DO UPDATE SET
				user_id = EXCLUDED.user_id,
				name = EXCLUDED.name,
				type = EXCLUDED.type,
				sport = EXCLUDED.sport,
				start_date_local = EXCLUDED.start_date_local,
				year = EXCLUDED.year,
				distance = EXCLUDED.distance,
				moving_time = EXCLUDED.moving_time,
				elapsed_time = EXCLUDED.elapsed_time,
				total_elevation_gain = EXCLUDED.total_elevation_gain
		`,
			a.id, a.userID, a.name, a.activityType, a.sport, a.startDateLocal, a.year,
			a.distance, a.movingTime, a.elapsedTime, a.elevationGain,
		)
		if err != nil {
			t.Fatalf("failed to insert test activity %d: %v", a.id, err)
		}
	}

	t.Logf("Inserted %d test activities", len(testActivities))
}
