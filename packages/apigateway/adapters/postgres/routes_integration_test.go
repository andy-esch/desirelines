//go:build integration

package postgres_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
)

// A 2x2 degree test region box around (-30, 0), and a small route inside its
// northern/western quadrant — far from any real geography, so these tests are
// deterministic regardless of what's in the regions table.
const (
	testRegionWKT = "POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))"
	testRouteWKT  = "LINESTRING(-30.5 0.3, -30 0.5, -29.5 0.7)"
)

func insertTestRegion(t *testing.T, tx pgx.Tx, code, kind string) int64 {
	t.Helper()
	var id int64
	err := tx.QueryRow(context.Background(), `
		INSERT INTO desirelines.regions (source, region_code, region_kind, region_name, geom)
		VALUES ('test', $1, $2, 'Test Region', ST_Multi(ST_GeomFromText($3, 4326)))
		RETURNING id`, code, kind, testRegionWKT).Scan(&id)
	if err != nil {
		t.Fatalf("insert test region: %v", err)
	}
	return id
}

// insertRoutedActivity inserts an activity + a route inside the test box. It is
// NOT tagged to a region (caller tags it if needed — an untagged routed activity
// is the "non-geographic / excluded from map" case).
func insertRoutedActivity(t *testing.T, tx pgx.Tx, id int64, userID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `
		INSERT INTO desirelines.activities (
			id, user_id, name, type, sport, start_date_local, year,
			distance, moving_time, elapsed_time, total_elevation_gain
		) VALUES ($1, $2, 'Geo Ride', 'Ride', 'Ride', $3, 2024, 1000, 100, 100, 10)`,
		id, userID, time.Date(2024, 1, 15, 8, 0, 0, 0, time.UTC),
	); err != nil {
		t.Fatalf("insert activity %d: %v", id, err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO desirelines.activity_routes (activity_id, route)
		VALUES ($1, ST_GeomFromText($2, 4326))`, id, testRouteWKT,
	); err != nil {
		t.Fatalf("insert route for %d: %v", id, err)
	}
}

// insertRoutelessActivity inserts an activity row WITHOUT an activity_routes row,
// so GetMapDataset's LEFT JOIN yields a NULL (omitted) bbox for it.
func insertRoutelessActivity(t *testing.T, tx pgx.Tx, id int64, userID string) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), `
		INSERT INTO desirelines.activities (
			id, user_id, name, type, sport, start_date_local, year,
			distance, moving_time, elapsed_time, total_elevation_gain
		) VALUES ($1, $2, 'Routeless', 'Ride', 'Ride', $3, 2024, 1000, 100, 100, 10)`,
		id, userID, time.Date(2024, 1, 15, 8, 0, 0, 0, time.UTC),
	); err != nil {
		t.Fatalf("insert routeless activity %d: %v", id, err)
	}
}

func tagActivityRegion(t *testing.T, tx pgx.Tx, activityID, regionID int64) {
	t.Helper()
	if _, err := tx.Exec(context.Background(),
		`INSERT INTO desirelines.activity_regions (activity_id, region_id) VALUES ($1, $2)`,
		activityID, regionID,
	); err != nil {
		t.Fatalf("tag activity %d: %v", activityID, err)
	}
}

// TestIntegration_MapEndpoints exercises GetRouteTile + GetRouteRegionSummary
// against real PostGIS (ST_AsMVT / ST_Intersects / ST_Extent), which the
// fake-querier unit tests can't validate.
//
//	go test -tags=integration -v ./adapters/postgres/...
func TestIntegration_MapEndpoints(t *testing.T) {
	connString := os.Getenv("POSTGRES_CONNECTION_STRING")
	if connString == "" {
		t.Skip("POSTGRES_CONNECTION_STRING not set, skipping integration tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	t.Run("RegionSummary_CountsAndBBox", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			regionID := insertTestRegion(t, tx, "r1", "cbsa_metro")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, regionID)

			got, err := repo.GetRouteRegionSummary(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetRouteRegionSummary: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("want 1 region, got %d", len(got))
			}
			s := got[0]
			if s.RegionID != regionID || s.Kind != "cbsa_metro" || s.ActivityCount != 1 {
				t.Errorf("unexpected summary: %+v (region=%d)", s, regionID)
			}
			// bbox should cover the region box [-31,-1]..[-29,1].
			if s.BBox[0] > -30.99 || s.BBox[1] > -0.99 || s.BBox[2] < -29.01 || s.BBox[3] < 0.99 {
				t.Errorf("bbox %v doesn't cover the test region", s.BBox)
			}
		})
	})

	t.Run("RegionSummary_UserIsolation", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			mine := insertTestRegion(t, tx, "r1", "county")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, mine)

			theirs := insertTestRegion(t, tx, "r2", "county")
			insertRoutedActivity(t, tx, 6001, "other-user")
			tagActivityRegion(t, tx, 6001, theirs)

			got, err := repo.GetRouteRegionSummary(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetRouteRegionSummary: %v", err)
			}
			if len(got) != 1 || got[0].RegionID != mine {
				t.Errorf("user isolation broken: %+v", got)
			}
		})
	})

	t.Run("Tile_CoveringNonEmpty_FarEmpty", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			regionID := insertTestRegion(t, tx, "r1", "county")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, regionID)

			// z1 tile (0,0) = NW hemisphere — covers the route.
			covering, err := repo.GetRouteTile(ctx, "test-user", 1, 0, 0)
			if err != nil {
				t.Fatalf("GetRouteTile covering: %v", err)
			}
			if len(covering) == 0 {
				t.Error("expected non-empty MVT for the covering tile")
			}

			// z1 tile (1,0) = NE hemisphere — no features.
			far, err := repo.GetRouteTile(ctx, "test-user", 1, 1, 0)
			if err != nil {
				t.Fatalf("GetRouteTile far: %v", err)
			}
			if len(far) != 0 {
				t.Errorf("expected empty MVT for a far tile, got %d bytes", len(far))
			}
		})
	})

	t.Run("Tile_ExcludesUntaggedActivity", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			// Routed but NOT tagged (the virtual/non-geographic case): the EXISTS
			// activity_regions filter must keep it out of the tile.
			insertRoutedActivity(t, tx, 5002, "test-user")

			tile, err := repo.GetRouteTile(ctx, "test-user", 1, 0, 0)
			if err != nil {
				t.Fatalf("GetRouteTile: %v", err)
			}
			if len(tile) != 0 {
				t.Errorf("untagged activity must be excluded; got %d bytes", len(tile))
			}
		})
	})
}

// TestIntegration_MapDataset exercises GetMapDataset against real PostGIS:
// scalars, aggregated region tag ids, the geo-only (untagged-excluded) rule, and
// the per-activity bbox (ST_Extent), which the fake-querier unit tests can't
// validate.
//
//	go test -tags=integration -v ./adapters/postgres/...
func TestIntegration_MapDataset(t *testing.T) {
	connString := os.Getenv("POSTGRES_CONNECTION_STRING")
	if connString == "" {
		t.Skip("POSTGRES_CONNECTION_STRING not set, skipping integration tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	defer pool.Close()

	t.Run("Scalars_RegionTags_AndBBox", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			// One activity tagged to TWO regions: regionIds must aggregate both.
			r1 := insertTestRegion(t, tx, "r1", "cbsa_metro")
			r2 := insertTestRegion(t, tx, "r2", "county")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, r1)
			tagActivityRegion(t, tx, 5001, r2)

			got, err := repo.GetMapDataset(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetMapDataset: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("want 1 activity, got %d", len(got))
			}
			a := got[0]
			if a.GetActivityId() != 5001 {
				t.Errorf("activityId = %d, want 5001", a.GetActivityId())
			}
			// insertRoutedActivity uses distance=1000, moving_time=100, elev=10, sport=Ride.
			if a.GetDistanceMeters() != 1000 || a.GetMovingTime() != 100 {
				t.Errorf("scalars wrong: distance=%v movingTime=%v", a.GetDistanceMeters(), a.GetMovingTime())
			}
			if a.GetElevationMeters() != 10 {
				t.Errorf("elevationMeters = %v, want 10", a.GetElevationMeters())
			}
			if a.GetSport() != "Ride" {
				t.Errorf("sport = %q, want raw Strava type %q (handler maps to category)", a.GetSport(), "Ride")
			}
			if a.GetStartDateLocal() == "" {
				t.Error("startDateLocal must be set")
			}
			// regionIds aggregate both tags, sorted ascending.
			ids := a.GetRegionIds()
			if len(ids) != 2 || ids[0] != min64(r1, r2) || ids[1] != max64(r1, r2) {
				t.Errorf("regionIds = %v, want sorted [%d %d]", ids, min64(r1, r2), max64(r1, r2))
			}
			// bbox covers the test route LINESTRING(-30.5 0.3 .. -29.5 0.7).
			bb := a.GetBbox()
			if len(bb) != 4 {
				t.Fatalf("bbox = %v, want 4 elements", bb)
			}
			if bb[0] > -30.49 || bb[1] > 0.31 || bb[2] < -29.51 || bb[3] < 0.69 {
				t.Errorf("bbox %v doesn't cover the test route", bb)
			}
		})
	})

	t.Run("ExcludesUntaggedActivity", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			region := insertTestRegion(t, tx, "r1", "county")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, region)

			// Routed but NOT tagged — must be excluded (geo-only rule).
			insertRoutedActivity(t, tx, 5002, "test-user")

			got, err := repo.GetMapDataset(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetMapDataset: %v", err)
			}
			if len(got) != 1 || got[0].GetActivityId() != 5001 {
				t.Errorf("geo-only rule broken: %+v", got)
			}
		})
	})

	t.Run("UserIsolation", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			mine := insertTestRegion(t, tx, "r1", "county")
			insertRoutedActivity(t, tx, 5001, "test-user")
			tagActivityRegion(t, tx, 5001, mine)

			theirs := insertTestRegion(t, tx, "r2", "county")
			insertRoutedActivity(t, tx, 6001, "other-user")
			tagActivityRegion(t, tx, 6001, theirs)

			got, err := repo.GetMapDataset(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetMapDataset: %v", err)
			}
			if len(got) != 1 || got[0].GetActivityId() != 5001 {
				t.Errorf("user isolation broken: %+v", got)
			}
		})
	})

	t.Run("NullBBoxWhenNoRoute", func(t *testing.T) {
		withTestTxRaw(t, pool, func(tx pgx.Tx, repo *postgres.ActivityRepository) {
			// A geo-bearing activity (tagged to a region) but with NO route
			// geometry. The LEFT JOIN must still return it — just without a bbox.
			// This pins the LEFT-vs-INNER join choice: an INNER JOIN would
			// silently drop it.
			region := insertTestRegion(t, tx, "r1", "county")
			insertRoutelessActivity(t, tx, 5003, "test-user")
			tagActivityRegion(t, tx, 5003, region)

			got, err := repo.GetMapDataset(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetMapDataset: %v", err)
			}
			if len(got) != 1 || got[0].GetActivityId() != 5003 {
				t.Fatalf("want the routeless activity returned, got %+v", got)
			}
			if bb := got[0].GetBbox(); len(bb) != 0 {
				t.Errorf("bbox = %v, want empty (activity has no route geometry)", bb)
			}
		})
	})
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
