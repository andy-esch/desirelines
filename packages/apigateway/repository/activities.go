package repository

import (
	"context"
	"io"

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

	// GetSportMetrics returns cumulative metrics timeseries for a sport category in a given year.
	// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
	// Used by: GET /activities/{year}/metrics?sport=X (without from/to params)
	GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*generated.SportMetrics, error)

	// GetSportMetricsByDateRange returns cumulative metrics for a date range.
	// Unlike GetSportMetrics, this can span multiple years (e.g., Dec 2025 - Jan 2026).
	// Used by: GET /activities/{year}/metrics?sport=X&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.SportMetrics, error)

	// GetDailySummary returns daily activity summaries for a sport category in a given year.
	// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
	// Used by: GET /activities/{year}/source?sport=X (without from/to params)
	GetDailySummary(ctx context.Context, year int, sportTypes []string) (*generated.DailySummary, error)

	// GetDailySummaryByDateRange returns daily activity summaries for a date range.
	// Unlike GetDailySummary, this can span multiple years (e.g., Dec 2025 - Jan 2026).
	// Used by: GET /activities/{year}/source?sport=X&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetDailySummaryByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.DailySummary, error)

	// GetMultiSportMetrics returns cumulative metrics for multiple sports in a single query.
	// Returns a map keyed by raw Strava sport type (e.g., "Ride", "VirtualRide").
	// The handler re-keys results by category using sportConfig.GetCategoryForStravaType().
	// Used by: GET /activities/{year}/metrics?sports=X,Y,Z (without from/to params)
	GetMultiSportMetrics(ctx context.Context, year int, sportTypes []string) (map[string]*generated.SportMetrics, error)

	// GetMultiSportMetricsByDateRange returns cumulative metrics for multiple sports in a date range.
	// Returns a map keyed by raw Strava sport type.
	// Used by: GET /activities/{year}/metrics?sports=X,Y,Z&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetMultiSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (map[string]*generated.SportMetrics, error)

	// GetMultiSportDailySummary returns daily summaries for multiple sports in a single query.
	// Returns a map keyed by raw Strava sport type.
	// Used by: GET /activities/{year}/source?sports=X,Y,Z (without from/to params)
	GetMultiSportDailySummary(ctx context.Context, year int, sportTypes []string) (map[string]*generated.DailySummary, error)

	// GetMultiSportDailySummaryByDateRange returns daily summaries for multiple sports in a date range.
	// Returns a map keyed by raw Strava sport type.
	// Used by: GET /activities/{year}/source?sports=X,Y,Z&from=YYYY-MM-DD&to=YYYY-MM-DD
	GetMultiSportDailySummaryByDateRange(ctx context.Context, from, to string, sportTypes []string) (map[string]*generated.DailySummary, error)

	// GetYearMetadata returns metadata about activities for a given year.
	// Used by: GET /activities/{year}/metadata
	GetYearMetadata(ctx context.Context, year int) (*generated.YearMetadata, error)

	// GetActivityByID returns a single activity by its Strava ID.
	// Returns nil (not error) if activity not found.
	// Used by: GET /activities/{id}
	GetActivityByID(ctx context.Context, id int64) (*activitiesv1.Activity, error)

	// ListActivities returns activities matching the filter criteria.
	// Uses cursor-based pagination for efficient sequential access.
	// Used by: GET /activities
	ListActivities(ctx context.Context, filter ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error)
}
