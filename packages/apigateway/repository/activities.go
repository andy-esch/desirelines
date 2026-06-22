package repository

import (
	"context"
	"io"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
)

// ActivityRepository defines read operations for activities.
// This interface abstracts database access, allowing different implementations
// (PostgreSQL, mock, etc.) to be injected.
type ActivityRepository interface {
	// Ping verifies database connectivity.
	Ping(ctx context.Context) error

	// Close releases database resources.
	io.Closer

	// GetMultiSportMetrics returns cumulative metrics for multiple sports in a single query.
	// Returns a map keyed by raw Strava sport type (e.g., "Ride", "VirtualRide").
	// The handler re-keys results by category using sportConfig.GetCategoryForStravaType().
	// loc determines "today" for current-year queries (caps the dense series at today in the given timezone).
	// Used by: GET /activities/{year}/metrics?sports=X,Y,Z (without from/to params)
	GetMultiSportMetrics(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.SportMetrics, error)

	// GetMultiSportMetricsByDateRange returns cumulative metrics for multiple sports in a date range.
	// Returns a map keyed by raw Strava sport type.
	// Used by: GET /activities/{year}/metrics?sports=X,Y,Z&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetMultiSportMetricsByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.SportMetrics, error)

	// GetMultiSportDailySummary returns daily summaries for multiple sports in a single query.
	// Returns a map keyed by raw Strava sport type.
	// loc determines "today" for current-year queries.
	// Used by: GET /activities/{year}/source?sports=X,Y,Z (without from/to params)
	GetMultiSportDailySummary(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.DailySummary, error)

	// GetMultiSportDailySummaryByDateRange returns daily summaries for multiple sports in a date range.
	// Returns a map keyed by raw Strava sport type.
	// Used by: GET /activities/{year}/source?sports=X,Y,Z&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetMultiSportDailySummaryByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.DailySummary, error)

	// GetYearMetadata returns metadata about activities for a given year.
	// Used by: GET /activities/{year}/metadata
	GetYearMetadata(ctx context.Context, userID string, year int) (*generated.YearMetadata, error)

	// GetActivityByID returns a single activity by its Strava ID.
	// Returns nil (not error) if activity not found — also returns nil if the
	// activity belongs to a different user (acts as authorization check).
	// Used by: GET /activities/{id}
	GetActivityByID(ctx context.Context, userID string, id int64) (*activitiesv1.Activity, error)

	// ListActivities returns activities matching the filter criteria.
	// Uses cursor-based pagination for efficient sequential access.
	// Used by: GET /activities
	ListActivities(ctx context.Context, filter ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error)

	// GetNormalizedRoutes returns activity routes with coordinates centered at (0,0).
	// Each route's start point is translated to the origin for overlaid visualization.
	// Used by: GET /activities/routes
	GetNormalizedRoutes(ctx context.Context, userID string, limit int) ([]NormalizedRoute, error)

	// GetRouteTile returns a Mapbox Vector Tile (ST_AsMVT bytes) of the user's
	// activity routes for the given z/x/y, in real-world coordinates. Includes
	// only geo-bearing activities (those with >=1 region tag), so virtual/indoor
	// activities are excluded. Returns an empty tile (not an error) when the tile
	// has no features.
	// Used by: GET /activities/map/tiles/{z}/{x}/{y}
	GetRouteTile(ctx context.Context, userID string, z, x, y int) ([]byte, error)

	// GetRouteRegionSummary returns each region the user has activities in, with
	// the activity count and the region's bounding box, sorted by count desc so
	// the client can default the map viewport to the densest region.
	// Used by: GET /activities/map/regions
	GetRouteRegionSummary(ctx context.Context, userID string) ([]RegionSummary, error)

	// GetMapDataset returns every geo-bearing activity (>=1 activity_regions row)
	// with scalar attributes, its aggregated region tag ids, and an optional
	// per-activity bounding box from its route geometry. Virtual/indoor activities
	// (no region tags) are excluded, matching the /map/tiles and /map/regions
	// inclusion rule. No pagination: the whole set is returned in one response for
	// the routes-map client-side cross-filter model. The Sport field holds the raw
	// Strava sport_type; the handler maps it to the app sport category.
	// Used by: GET /activities/map/dataset
	GetMapDataset(ctx context.Context, userID string) ([]*activitiesv1.MapActivity, error)
}
