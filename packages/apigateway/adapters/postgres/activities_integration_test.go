//go:build integration

package postgres_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/otel"
)

// TestIntegration_ActivityRepository runs integration tests against a real PostgreSQL database.
// Each subtest runs inside a transaction that is rolled back after the test,
// providing full isolation without manual INSERT/DELETE cleanup.
//
// To run: go test -tags=integration -v ./adapters/postgres/...
//
// Requires:
// - POSTGRES_CONNECTION_STRING env var set to a valid connection string
// - Database with desirelines schema and activities table (run Flyway migrations first)
//
// Example setup:
//
//	make start-frontend  # Starts postgres and runs migrations
//	export POSTGRES_CONNECTION_STRING="postgresql://desirelines:local_dev_password@localhost:15430/desirelines_local?application_name=integration-test"
//	go test -tags=integration -v ./adapters/postgres/...
func TestIntegration_ActivityRepository(t *testing.T) {
	connString := os.Getenv("POSTGRES_CONNECTION_STRING")
	if connString == "" {
		t.Skip("POSTGRES_CONNECTION_STRING not set, skipping integration tests")
	}

	ctx := context.Background()

	// Create a raw pool for starting transactions (bypassing our Pool wrapper validation)
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	// Verify our Pool wrapper still works (connection string validation, etc.)
	t.Run("PoolWrapper", func(t *testing.T) {
		wrappedPool, err := postgres.NewPool(ctx, connString, slog.Default(), nil)
		if err != nil {
			t.Fatalf("failed to create wrapped pool: %v", err)
		}
		noopHist, _ := otel.NoopProviders().Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
		repo := postgres.NewActivityRepository(wrappedPool, noopHist, nil)
		defer repo.Close()

		if err := repo.Ping(ctx); err != nil {
			t.Errorf("Ping failed: %v", err)
		}
	})

	t.Run("GetYearMetadata", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			metadata, err := repo.GetYearMetadata(ctx, "test-user", 2024)
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
	})

	t.Run("GetYearMetadata_NoResults", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			metadata, err := repo.GetYearMetadata(ctx, "test-user", 1999)
			if err != nil {
				t.Fatalf("GetYearMetadata failed: %v", err)
			}

			if len(metadata.Sports) != 0 {
				t.Errorf("expected 0 sports for year with no data, got %d", len(metadata.Sports))
			}
		})
	})

	t.Run("GetActivityByID", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			activity, err := repo.GetActivityByID(ctx, "test-user", 1001)
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
	})

	t.Run("GetActivityByID_NotFound", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			activity, err := repo.GetActivityByID(ctx, "test-user", 99999999)
			if err != nil {
				t.Fatalf("GetActivityByID failed: %v", err)
			}

			if activity != nil {
				t.Errorf("expected nil for non-existent activity, got %+v", activity)
			}
		})
	})

	t.Run("ListActivities_Basic", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  10,
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
	})

	t.Run("ListActivities_HasRoute", func(t *testing.T) {
		// has_route mirrors the /activities/map/dataset inclusion rule: it is true
		// iff the activity is tagged to >=1 region — NOT merely that it has route
		// geometry. A routed-but-untagged activity is still false, so the "view on
		// map" pin only appears when the routes map can actually show the activity.
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			regionID := insertTestRegion(t, tx, "r1", "cbsa_metro")
			insertRoutedActivity(t, tx, 5001, "test-user") // routed + tagged → true
			tagActivityRegion(t, tx, 5001, regionID)
			insertRoutedActivity(t, tx, 5002, "test-user")    // routed, untagged → false
			insertRoutelessActivity(t, tx, 5003, "test-user") // routeless → false

			resp, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  10,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}

			got := make(map[int64]bool, len(resp.Activities))
			for _, a := range resp.Activities {
				got[a.Id] = a.HasRoute
			}
			if !got[5001] {
				t.Error("activity 5001 (region-tagged) should have HasRoute=true")
			}
			if got[5002] {
				t.Error("activity 5002 (routed but untagged) should have HasRoute=false")
			}
			if got[5003] {
				t.Error("activity 5003 (routeless) should have HasRoute=false")
			}
		})
	})

	t.Run("ListActivities_WithLimit", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  2,
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
	})

	t.Run("ListActivities_WithSportFilter", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID:     "test-user",
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
	})

	t.Run("ListActivities_FiltersBySportNotType", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			// Yoga has type="Workout" but sport="Yoga". Filtering by ["Yoga"]
			// must match the sport column to find it.
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID:     "test-user",
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
	})

	t.Run("ListActivities_WithDateRange", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			from := "2024-01-15"
			to := "2024-01-15"
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				From:   &from,
				To:     &to,
				Limit:  10,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}

			// Should return 3 activities from Jan 15 (Ride at 8am, Run at 7am, Yoga at 6am)
			if len(response.Activities) != 3 {
				t.Errorf("expected 3 activities on Jan 15, got %d", len(response.Activities))
			}
		})
	})

	t.Run("ListActivities_NoResults", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			from := "2023-01-01"
			to := "2023-12-31"
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				From:   &from,
				To:     &to,
				Limit:  10,
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
	})

	t.Run("ListActivities_DefaultLimit", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			// When limit is 0 or not set, should default to 20
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  0,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}

			// With only 4 test activities, should return all
			if len(response.Activities) != 4 {
				t.Errorf("expected 4 activities with default limit, got %d", len(response.Activities))
			}
		})
	})

	t.Run("ListActivities_MaxLimit", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			// When limit exceeds 100, should cap at 100
			response, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  500,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}

			// With only 4 test activities, should return all (but limit was capped)
			if len(response.Activities) != 4 {
				t.Errorf("expected 4 activities with max limit, got %d", len(response.Activities))
			}
		})
	})

	// =========================================================================
	// Multi-sport query tests
	// =========================================================================

	t.Run("GetMultiSportMetrics", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			// Request Ride and Run together — should get separate timeseries per sport
			result, err := repo.GetMultiSportMetrics(ctx, "test-user", 2024, []string{"Ride", "Run"}, time.UTC)
			if err != nil {
				t.Fatalf("GetMultiSportMetrics failed: %v", err)
			}

			if len(result) != 2 {
				t.Fatalf("expected 2 sports in result, got %d", len(result))
			}

			// Ride: dense series for the full year
			rideMetrics := result["Ride"]
			if rideMetrics == nil {
				t.Fatal("expected Ride metrics in result")
			}
			if len(rideMetrics.Timeseries) != 366 {
				t.Errorf("expected 366 Ride timeseries entries, got %d", len(rideMetrics.Timeseries))
			}
			// Ride cumulative: Jan 15 = 10000, Jan 16 = 25000
			rideJan16 := findMetricsEntry(t, rideMetrics.Timeseries, "2024-01-16")
			if rideJan16.Distance == nil || *rideJan16.Distance != 25000 {
				t.Errorf("expected Ride cumulative distance 25000 on Jan 16, got %v", rideJan16.Distance)
			}

			// Run: dense series for the full year
			runMetrics := result["Run"]
			if runMetrics == nil {
				t.Fatal("expected Run metrics in result")
			}
			if len(runMetrics.Timeseries) != 366 {
				t.Errorf("expected 366 Run timeseries entries, got %d", len(runMetrics.Timeseries))
			}
			// Run cumulative stays flat after Jan 15: Jan 16 onward = 5000
			runJan16 := findMetricsEntry(t, runMetrics.Timeseries, "2024-01-16")
			if runJan16.Distance == nil || *runJan16.Distance != 5000 {
				t.Errorf("expected Run cumulative distance 5000 on Jan 16, got %v", runJan16.Distance)
			}
		})
	})

	t.Run("GetMultiSportMetrics_IncludesSportWithNoActivities", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			// "NonexistentSport" has no activities — unnest should still include it
			// in the result with a full zero-filled timeseries
			result, err := repo.GetMultiSportMetrics(ctx, "test-user", 2024, []string{"Ride", "NonexistentSport"}, time.UTC)
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
	})

	t.Run("GetMultiSportMetricsByDateRange", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			result, err := repo.GetMultiSportMetricsByDateRange(ctx, "test-user", "2024-01-15", "2024-01-16", []string{"Ride", "Run"})
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
	})

	t.Run("GetMultiSportDailySummary", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			result, err := repo.GetMultiSportDailySummary(ctx, "test-user", 2024, []string{"Ride", "Run", "Yoga"}, time.UTC)
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
			yogaJan15, ok := yogaSummary.Daily["2024-01-15"]
			if !ok {
				t.Fatal("expected Yoga entry for 2024-01-15")
			}
			if len(yogaJan15.ActivityIds) == 0 || yogaJan15.ActivityIds[0] != 1004 {
				t.Errorf("expected Yoga activity ID 1004, got %v", yogaJan15.ActivityIds)
			}
		})
	})

	t.Run("GetMultiSportDailySummaryByDateRange", func(t *testing.T) {
		withTestTx(t, pool, func(repo *postgres.ActivityRepository) {
			result, err := repo.GetMultiSportDailySummaryByDateRange(ctx, "test-user", "2024-01-15", "2024-01-16", []string{"Ride", "Run"})
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
	})

	// TestStartDateLocal_NoUTCConversion regression-tests the rule documented
	// in the activities.go package doc and reinforced by the V0004
	// COMMENT ON COLUMN migration. An activity stored at 2024-12-31T23:30:00
	// (athlete-local late-night Dec 31) must be returned by a "2024-12-31"
	// date-range query — never "2025-01-01" as a UTC conversion would yield.
	// If this test fails, someone has re-introduced timezone conversion
	// somewhere along the read or write path.
	t.Run("StartDateLocal_NoUTCConversion", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			// Insert a single activity at 2024-12-31 23:30:00 athlete-local.
			// Using time.Date with time.UTC here is a Go-side convenience for
			// constructing the value; the DB column is TIMESTAMP WITHOUT TIME
			// ZONE, so what gets stored is the wall-clock "2024-12-31 23:30:00"
			// — no timezone attached, no conversion.
			lateNight := time.Date(2024, 12, 31, 23, 30, 0, 0, time.UTC)
			_, err := tx.Exec(ctx, `
				INSERT INTO desirelines.activities (
					id, user_id, name, type, sport, start_date_local, year,
					distance, moving_time, elapsed_time, total_elevation_gain
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			`,
				int64(9001), "tz-user", "New Year's Eve Run", "Run", "Run",
				lateNight, 2024,
				float64(5000), int32(1500), int32(1600), float64(50),
			)
			if err != nil {
				t.Fatalf("insert late-night activity: %v", err)
			}

			// Query for from=2024-12-31, to=2024-12-31 — must include it.
			result, err := repo.GetMultiSportDailySummaryByDateRange(
				ctx, "tz-user", "2024-12-31", "2024-12-31", []string{"Run"},
			)
			if err != nil {
				t.Fatalf("GetMultiSportDailySummaryByDateRange (Dec 31): %v", err)
			}
			runSummary := result["Run"]
			if runSummary == nil {
				t.Fatal("expected Run entry in Dec 31 result")
			}
			dec31 := runSummary.Daily["2024-12-31"]
			if dec31 == nil {
				t.Fatalf("expected 2024-12-31 bucket; got daily=%v", runSummary.Daily)
			}
			if len(dec31.ActivityIds) != 1 || dec31.ActivityIds[0] != 9001 {
				t.Errorf("expected activity 9001 in 2024-12-31 bucket, got %v", dec31.ActivityIds)
			}
			if _, leaked := runSummary.Daily["2025-01-01"]; leaked {
				t.Error("activity leaked into 2025-01-01 bucket — UTC conversion regression")
			}

			// Query for from=2025-01-01, to=2025-01-01 — must NOT include it.
			result2, err := repo.GetMultiSportDailySummaryByDateRange(
				ctx, "tz-user", "2025-01-01", "2025-01-01", []string{"Run"},
			)
			if err != nil {
				t.Fatalf("GetMultiSportDailySummaryByDateRange (Jan 1): %v", err)
			}
			if run2 := result2["Run"]; run2 != nil && len(run2.Daily) > 0 {
				t.Errorf("expected no Run entries on 2025-01-01, got %v", run2.Daily)
			}

			// ListActivities must apply the same local-date filter, not UTC.
			from, to := "2024-12-31", "2024-12-31"
			listResp, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "tz-user",
				From:   &from,
				To:     &to,
				Limit:  10,
			})
			if err != nil {
				t.Fatalf("ListActivities (Dec 31): %v", err)
			}
			if len(listResp.Activities) != 1 || listResp.Activities[0].Id != 9001 {
				t.Errorf("expected activity 9001 in ListActivities Dec 31 result, got %+v", listResp.Activities)
			}
		})
	})

	// =========================================================================
	// Multi-user isolation tests
	// =========================================================================

	t.Run("UserIsolation_GetYearMetadata", func(t *testing.T) {
		withTestTxMultiUser(t, pool, func(repo *postgres.ActivityRepository) {
			// test-user should see 3 sports (Ride, Run, Yoga)
			metadata, err := repo.GetYearMetadata(ctx, "test-user", 2024)
			if err != nil {
				t.Fatalf("GetYearMetadata failed: %v", err)
			}
			if len(metadata.Sports) != 3 {
				t.Errorf("test-user: expected 3 sports, got %d: %v", len(metadata.Sports), metadata.Sports)
			}

			// other-user should see only 1 sport (Run)
			metadata2, err := repo.GetYearMetadata(ctx, "other-user", 2024)
			if err != nil {
				t.Fatalf("GetYearMetadata failed: %v", err)
			}
			if len(metadata2.Sports) != 1 {
				t.Errorf("other-user: expected 1 sport, got %d: %v", len(metadata2.Sports), metadata2.Sports)
			}
			if len(metadata2.Sports) > 0 && metadata2.Sports[0] != "Run" {
				t.Errorf("other-user: expected sport Run, got %s", metadata2.Sports[0])
			}
		})
	})

	t.Run("UserIsolation_GetActivityByID", func(t *testing.T) {
		withTestTxMultiUser(t, pool, func(repo *postgres.ActivityRepository) {
			// test-user can see their own activity
			activity, err := repo.GetActivityByID(ctx, "test-user", 1001)
			if err != nil {
				t.Fatalf("GetActivityByID failed: %v", err)
			}
			if activity == nil {
				t.Fatal("test-user should see activity 1001")
			}

			// other-user cannot see test-user's activity (returns nil, not error)
			activity2, err := repo.GetActivityByID(ctx, "other-user", 1001)
			if err != nil {
				t.Fatalf("GetActivityByID failed: %v", err)
			}
			if activity2 != nil {
				t.Error("other-user should NOT see test-user's activity 1001")
			}

			// other-user can see their own activity
			activity3, err := repo.GetActivityByID(ctx, "other-user", 2001)
			if err != nil {
				t.Fatalf("GetActivityByID failed: %v", err)
			}
			if activity3 == nil {
				t.Fatal("other-user should see activity 2001")
			}
		})
	})

	t.Run("UserIsolation_ListActivities", func(t *testing.T) {
		withTestTxMultiUser(t, pool, func(repo *postgres.ActivityRepository) {
			// test-user should see 4 activities
			resp1, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "test-user",
				Limit:  10,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}
			if len(resp1.Activities) != 4 {
				t.Errorf("test-user: expected 4 activities, got %d", len(resp1.Activities))
			}

			// other-user should see 1 activity
			resp2, err := repo.ListActivities(ctx, repository.ActivityListFilter{
				UserID: "other-user",
				Limit:  10,
			})
			if err != nil {
				t.Fatalf("ListActivities failed: %v", err)
			}
			if len(resp2.Activities) != 1 {
				t.Errorf("other-user: expected 1 activity, got %d", len(resp2.Activities))
			}
		})
	})

	t.Run("UserIsolation_GetMultiSportMetrics", func(t *testing.T) {
		withTestTxMultiUser(t, pool, func(repo *postgres.ActivityRepository) {
			// other-user queries for Ride — should get zero-filled data (they have no Rides)
			result, err := repo.GetMultiSportMetrics(ctx, "other-user", 2024, []string{"Ride"}, time.UTC)
			if err != nil {
				t.Fatalf("GetMultiSportMetrics failed: %v", err)
			}
			rideMetrics := result["Ride"]
			if rideMetrics == nil {
				t.Fatal("expected Ride key in result (zero-filled)")
			}
			// All cumulative values should be zero since other-user has no Rides
			lastEntry := rideMetrics.Timeseries[len(rideMetrics.Timeseries)-1]
			if lastEntry.Distance != nil && *lastEntry.Distance != 0 {
				t.Errorf("other-user: expected 0 cumulative Ride distance, got %f", *lastEntry.Distance)
			}
		})
	})
}

// findMetricsEntry finds a timeseries entry by date, failing the test if not found.
func findMetricsEntry(t *testing.T, entries []*generated.CumulativeMetricsEntry, date string) *generated.CumulativeMetricsEntry {
	t.Helper()
	for _, e := range entries {
		if e.Date == date {
			return e
		}
	}
	t.Fatalf("no timeseries entry found for date %s", date)
	return nil
}

// keysOf returns the keys of a map for diagnostic output.
func keysOf[K comparable, V any](m map[K]V) []K {
	keys := make([]K, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
