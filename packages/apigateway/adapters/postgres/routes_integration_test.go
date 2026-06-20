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
