//go:build integration

package postgres_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
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
	pool, err := postgres.NewPool(ctx, connString, slog.Default())
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
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
		// Protobuf optional fields are pointers, need to dereference
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

	// Test that queries filter on the 'sport' column (Strava sport_type), not the 'type'
	// column (Strava broad type). Yoga has type="Workout" but sport="Yoga", so filtering
	// by ["Yoga"] must match the sport column to find it.
	t.Run("GetSportMetrics_FiltersBySportNotType", func(t *testing.T) {
		metrics, err := repo.GetSportMetrics(ctx, 2024, []string{"Yoga"})
		if err != nil {
			t.Fatalf("GetSportMetrics failed: %v", err)
		}

		if len(metrics.Timeseries) != 1 {
			t.Errorf("expected 1 timeseries entry for Yoga, got %d", len(metrics.Timeseries))
		}

		if len(metrics.Timeseries) > 0 && metrics.Timeseries[0].Date != "2024-01-15" {
			t.Errorf("expected Yoga entry on 2024-01-15, got %s", metrics.Timeseries[0].Date)
		}
	})

	t.Run("GetSportMetrics_FiltersBySportNotType_Negative", func(t *testing.T) {
		// Filtering by "Workout" (the broad type) should NOT return the Yoga activity,
		// because the sport column contains "Yoga", not "Workout".
		metrics, err := repo.GetSportMetrics(ctx, 2024, []string{"Workout"})
		if err != nil {
			t.Fatalf("GetSportMetrics failed: %v", err)
		}

		if len(metrics.Timeseries) != 0 {
			t.Errorf("expected 0 timeseries entries for type 'Workout', got %d", len(metrics.Timeseries))
		}
	})

	t.Run("GetDailySummary", func(t *testing.T) {
		// Pass Strava sport types that map to "cycling" category
		summary, err := repo.GetDailySummary(ctx, 2024, []string{"Ride", "VirtualRide"})
		if err != nil {
			t.Fatalf("GetDailySummary failed: %v", err)
		}

		if len(summary.Daily) != 2 {
			t.Errorf("expected 2 daily entries, got %d", len(summary.Daily))
		}

		// Check Jan 15 entry
		jan15 := summary.Daily["2024-01-15"]
		if jan15 == nil {
			t.Fatal("expected entry for 2024-01-15")
		}

		if jan15.DistanceMeters == nil || *jan15.DistanceMeters != 10000 {
			t.Errorf("expected distance 10000, got %v", jan15.DistanceMeters)
		}

		if jan15.Activities != 1 {
			t.Errorf("expected 1 activity, got %d", jan15.Activities)
		}

		if len(jan15.ActivityIds) != 1 || jan15.ActivityIds[0] != 1001 {
			t.Errorf("expected activity ID [1001], got %v", jan15.ActivityIds)
		}
	})

	t.Run("GetDailySummary_FiltersBySportNotType", func(t *testing.T) {
		// Yoga has type="Workout" but sport="Yoga". Filtering by ["Yoga"]
		// must match the sport column to find it.
		summary, err := repo.GetDailySummary(ctx, 2024, []string{"Yoga"})
		if err != nil {
			t.Fatalf("GetDailySummary failed: %v", err)
		}

		if len(summary.Daily) != 1 {
			t.Errorf("expected 1 daily entry for Yoga, got %d", len(summary.Daily))
		}

		jan15 := summary.Daily["2024-01-15"]
		if jan15 == nil {
			t.Fatal("expected Yoga entry for 2024-01-15")
		}

		if jan15.Activities != 1 {
			t.Errorf("expected 1 Yoga activity, got %d", jan15.Activities)
		}

		if len(jan15.ActivityIds) != 1 || jan15.ActivityIds[0] != 1004 {
			t.Errorf("expected activity ID [1004], got %v", jan15.ActivityIds)
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

		// Should have Ride, Run, and Yoga (raw Strava sport types)
		if len(metadata.Sports) != 3 {
			t.Errorf("expected 3 sports, got %d: %v", len(metadata.Sports), metadata.Sports)
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

	t.Run("GetActivityByID", func(t *testing.T) {
		activity, err := repo.GetActivityByID(ctx, 1001)
		if err != nil {
			t.Fatalf("GetActivityByID failed: %v", err)
		}

		if activity == nil {
			t.Fatal("expected activity, got nil")
		}

		if activity.Id != 1001 {
			t.Errorf("expected ID 1001, got %d", activity.Id)
		}

		if activity.Name != "Morning Ride" {
			t.Errorf("expected name 'Morning Ride', got %s", activity.Name)
		}

		if activity.Type != "Ride" {
			t.Errorf("expected type 'Ride', got %s", activity.Type)
		}

		if activity.Sport != "Ride" {
			t.Errorf("expected sport 'Ride', got %s", activity.Sport)
		}

		if activity.DistanceMeters != 10000 {
			t.Errorf("expected distance 10000, got %f", activity.DistanceMeters)
		}

		if activity.MovingTimeSeconds != 1800 {
			t.Errorf("expected moving time 1800, got %d", activity.MovingTimeSeconds)
		}
	})

	t.Run("GetActivityByID_NotFound", func(t *testing.T) {
		activity, err := repo.GetActivityByID(ctx, 99999999)
		if err != nil {
			t.Fatalf("GetActivityByID failed: %v", err)
		}

		if activity != nil {
			t.Errorf("expected nil for non-existent activity, got %+v", activity)
		}
	})

	t.Run("ListActivities_Basic", func(t *testing.T) {
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			Limit: 10,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		// Should return all 4 test activities
		if len(response.Activities) != 4 {
			t.Errorf("expected 4 activities, got %d", len(response.Activities))
		}

		// Should be ordered by start_date_local DESC (newest first)
		// Jan 16 > Jan 15 (ride at 8am) > Jan 15 (run at 7am) > Jan 15 (yoga at 6am)
		if response.Activities[0].Id != 1002 {
			t.Errorf("expected first activity ID 1002 (newest), got %d", response.Activities[0].Id)
		}

		// No more results
		if response.HasMore {
			t.Error("expected HasMore to be false")
		}
	})

	t.Run("ListActivities_WithLimit", func(t *testing.T) {
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			Limit: 2,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		if len(response.Activities) != 2 {
			t.Errorf("expected 2 activities, got %d", len(response.Activities))
		}

		if !response.HasMore {
			t.Error("expected HasMore to be true")
		}

		if response.NextCursor == nil {
			t.Error("expected NextCursor to be set")
		}
	})

	t.Run("ListActivities_WithSportFilter", func(t *testing.T) {
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			SportTypes: []string{"Ride"},
			Limit:      10,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		// Should only return 2 Ride activities
		if len(response.Activities) != 2 {
			t.Errorf("expected 2 Ride activities, got %d", len(response.Activities))
		}

		for _, a := range response.Activities {
			if a.Sport != "Ride" {
				t.Errorf("expected sport 'Ride', got %s", a.Sport)
			}
		}
	})

	t.Run("ListActivities_FiltersBySportNotType", func(t *testing.T) {
		// Yoga has type="Workout" but sport="Yoga". Filtering by ["Yoga"]
		// must match the sport column to find it.
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			SportTypes: []string{"Yoga"},
			Limit:      10,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		if len(response.Activities) != 1 {
			t.Errorf("expected 1 Yoga activity, got %d", len(response.Activities))
		}

		if len(response.Activities) > 0 {
			if response.Activities[0].Sport != "Yoga" {
				t.Errorf("expected sport 'Yoga', got %s", response.Activities[0].Sport)
			}
			if response.Activities[0].Type != "Workout" {
				t.Errorf("expected type 'Workout', got %s", response.Activities[0].Type)
			}
		}
	})

	t.Run("ListActivities_WithDateRange", func(t *testing.T) {
		from := "2024-01-15"
		to := "2024-01-15"
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			From:  &from,
			To:    &to,
			Limit: 10,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		// Should return 3 activities from Jan 15 (Ride at 8am, Run at 7am, Yoga at 6am)
		if len(response.Activities) != 3 {
			t.Errorf("expected 3 activities on Jan 15, got %d", len(response.Activities))
		}
	})

	t.Run("ListActivities_NoResults", func(t *testing.T) {
		from := "2023-01-01"
		to := "2023-12-31"
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			From:  &from,
			To:    &to,
			Limit: 10,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		if len(response.Activities) != 0 {
			t.Errorf("expected 0 activities in 2023, got %d", len(response.Activities))
		}

		if response.HasMore {
			t.Error("expected HasMore to be false")
		}
	})

	t.Run("ListActivities_DefaultLimit", func(t *testing.T) {
		// When limit is 0 or not set, should default to 20
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			Limit: 0,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		// With only 4 test activities, should return all
		if len(response.Activities) != 4 {
			t.Errorf("expected 4 activities with default limit, got %d", len(response.Activities))
		}
	})

	t.Run("ListActivities_MaxLimit", func(t *testing.T) {
		// When limit exceeds 100, should cap at 100
		response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
			Limit: 500,
		})
		if err != nil {
			t.Fatalf("ListActivities failed: %v", err)
		}

		// With only 4 test activities, should return all (but limit was capped)
		if len(response.Activities) != 4 {
			t.Errorf("expected 4 activities with max limit, got %d", len(response.Activities))
		}
	})

	// =========================================================================
	// Multi-sport query tests
	// =========================================================================

	t.Run("GetMultiSportMetrics", func(t *testing.T) {
		// Request Ride and Run together — should get separate timeseries per sport
		result, err := repo.GetMultiSportMetrics(ctx, 2024, []string{"Ride", "Run"})
		if err != nil {
			t.Fatalf("GetMultiSportMetrics failed: %v", err)
		}

		if len(result) != 2 {
			t.Fatalf("expected 2 sports in result, got %d", len(result))
		}

		// Ride has activities on Jan 15 and Jan 16
		rideMetrics := result["Ride"]
		if rideMetrics == nil {
			t.Fatal("expected Ride metrics in result")
		}
		if len(rideMetrics.Timeseries) != 2 {
			t.Errorf("expected 2 Ride timeseries entries, got %d", len(rideMetrics.Timeseries))
		}
		// Ride cumulative: Jan 15 = 10000, Jan 16 = 25000
		if rideMetrics.Timeseries[1].Distance == nil || *rideMetrics.Timeseries[1].Distance != 25000 {
			t.Errorf("expected Ride cumulative distance 25000, got %v", rideMetrics.Timeseries[1].Distance)
		}

		// Run has activity only on Jan 15, but dense series covers Jan 15-16
		runMetrics := result["Run"]
		if runMetrics == nil {
			t.Fatal("expected Run metrics in result")
		}
		if len(runMetrics.Timeseries) != 2 {
			t.Errorf("expected 2 Run timeseries entries (dense), got %d", len(runMetrics.Timeseries))
		}
		// Run cumulative stays flat after Jan 15: both days = 5000
		if runMetrics.Timeseries[1].Distance == nil || *runMetrics.Timeseries[1].Distance != 5000 {
			t.Errorf("expected Run cumulative distance 5000 on Jan 16, got %v", runMetrics.Timeseries[1].Distance)
		}
	})

	t.Run("GetMultiSportMetrics_IncludesSportWithNoActivities", func(t *testing.T) {
		// "NonexistentSport" has no activities — unnest should still include it
		// in the result with a full zero-filled timeseries
		result, err := repo.GetMultiSportMetrics(ctx, 2024, []string{"Ride", "NonexistentSport"})
		if err != nil {
			t.Fatalf("GetMultiSportMetrics failed: %v", err)
		}

		if len(result) != 2 {
			t.Fatalf("expected 2 sports in result (including zero-activity sport), got %d: %v", len(result), keysOf(result))
		}

		noActivityMetrics := result["NonexistentSport"]
		if noActivityMetrics == nil {
			t.Fatal("expected NonexistentSport in result with zero-filled timeseries")
		}

		// Should have same number of dates as Ride
		rideMetrics := result["Ride"]
		if len(noActivityMetrics.Timeseries) != len(rideMetrics.Timeseries) {
			t.Errorf("expected NonexistentSport to have %d entries (same as Ride), got %d",
				len(rideMetrics.Timeseries), len(noActivityMetrics.Timeseries))
		}

		// All cumulative values should be zero
		for i, entry := range noActivityMetrics.Timeseries {
			if entry.Distance != nil && *entry.Distance != 0 {
				t.Errorf("entry %d: expected distance 0, got %f", i, *entry.Distance)
			}
			if entry.Activities != nil && *entry.Activities != 0 {
				t.Errorf("entry %d: expected activities 0, got %d", i, *entry.Activities)
			}
		}
	})

	t.Run("GetMultiSportMetricsByDateRange", func(t *testing.T) {
		result, err := repo.GetMultiSportMetricsByDateRange(ctx, "2024-01-15", "2024-01-16", []string{"Ride", "Run"})
		if err != nil {
			t.Fatalf("GetMultiSportMetricsByDateRange failed: %v", err)
		}

		if len(result) != 2 {
			t.Fatalf("expected 2 sports, got %d", len(result))
		}

		// Same assertions as year-based — cumulative Ride = 25000 on Jan 16
		rideMetrics := result["Ride"]
		if rideMetrics == nil || len(rideMetrics.Timeseries) != 2 {
			t.Fatalf("expected 2 Ride timeseries entries, got %v", rideMetrics)
		}
		if rideMetrics.Timeseries[1].Distance == nil || *rideMetrics.Timeseries[1].Distance != 25000 {
			t.Errorf("expected Ride cumulative distance 25000, got %v", rideMetrics.Timeseries[1].Distance)
		}
	})

	t.Run("GetMultiSportDailySummary", func(t *testing.T) {
		result, err := repo.GetMultiSportDailySummary(ctx, 2024, []string{"Ride", "Run", "Yoga"})
		if err != nil {
			t.Fatalf("GetMultiSportDailySummary failed: %v", err)
		}

		if len(result) != 3 {
			t.Fatalf("expected 3 sports in result, got %d", len(result))
		}

		// Ride: 2 days of data
		rideSummary := result["Ride"]
		if rideSummary == nil || len(rideSummary.Daily) != 2 {
			t.Fatalf("expected 2 Ride daily entries, got %v", rideSummary)
		}

		// Run: 1 day of data
		runSummary := result["Run"]
		if runSummary == nil || len(runSummary.Daily) != 1 {
			t.Fatalf("expected 1 Run daily entry, got %v", runSummary)
		}
		runJan15 := runSummary.Daily["2024-01-15"]
		if runJan15 == nil || runJan15.Activities != 1 {
			t.Errorf("expected 1 Run activity on Jan 15, got %v", runJan15)
		}

		// Yoga: 1 day of data
		yogaSummary := result["Yoga"]
		if yogaSummary == nil || len(yogaSummary.Daily) != 1 {
			t.Fatalf("expected 1 Yoga daily entry, got %v", yogaSummary)
		}
		if yogaSummary.Daily["2024-01-15"].ActivityIds[0] != 1004 {
			t.Errorf("expected Yoga activity ID 1004, got %v", yogaSummary.Daily["2024-01-15"].ActivityIds)
		}
	})

	t.Run("GetMultiSportDailySummaryByDateRange", func(t *testing.T) {
		result, err := repo.GetMultiSportDailySummaryByDateRange(ctx, "2024-01-15", "2024-01-16", []string{"Ride", "Run"})
		if err != nil {
			t.Fatalf("GetMultiSportDailySummaryByDateRange failed: %v", err)
		}

		if len(result) != 2 {
			t.Fatalf("expected 2 sports, got %d", len(result))
		}

		rideSummary := result["Ride"]
		if rideSummary == nil || len(rideSummary.Daily) != 2 {
			t.Fatalf("expected 2 Ride daily entries, got %v", rideSummary)
		}

		runSummary := result["Run"]
		if runSummary == nil || len(runSummary.Daily) != 1 {
			t.Fatalf("expected 1 Run daily entry, got %v", runSummary)
		}
	})
}

// keysOf returns the keys of a map for diagnostic output.
func keysOf[K comparable, V any](m map[K]V) []K {
	keys := make([]K, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// cleanupTestData removes test data from the database
func cleanupTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	// Delete test activities (IDs 1001-1004)
	_, err := pool.Exec(ctx, `
		DELETE FROM desirelines.activities
		WHERE id IN (1001, 1002, 1003, 1004)
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
	// - 1 yoga activity: Jan 15 (type="Workout", sport="Yoga" — exercises the type≠sport case)
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
		{
			id:             1004,
			userID:         "test-user",
			name:           "Morning Yoga",
			activityType:   "Workout", // Strava type (broad category)
			sport:          "Yoga",    // Strava sport_type (specific) — differs from type!
			startDateLocal: time.Date(2024, 1, 15, 6, 0, 0, 0, time.UTC),
			year:           2024,
			distance:       0,    // Non-distance sport
			movingTime:     3600, // 60 minutes in seconds
			elapsedTime:    3700,
			elevationGain:  0,
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
