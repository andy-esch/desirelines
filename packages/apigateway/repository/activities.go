// Package repository defines domain interfaces for data access.
// These are ports in hexagonal architecture - they belong to the domain layer.
package repository

import (
	"context"
	"io"
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
	// Used by: GET /activities/{year}/metrics?sport=X
	GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*SportMetrics, error)

	// GetDailySummary returns daily activity summaries for a sport category in a given year.
	// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
	// Used by: GET /activities/{year}/source?sport=X
	GetDailySummary(ctx context.Context, year int, sportTypes []string) (DailySummary, error)

	// GetYearMetadata returns metadata about activities for a given year.
	// Used by: GET /activities/{year}/metadata
	GetYearMetadata(ctx context.Context, year int) (*YearMetadata, error)

	// GetActivityByID returns a single activity by its Strava ID.
	// Returns nil (not error) if activity not found.
	// Used by: GET /activities/{id}
	GetActivityByID(ctx context.Context, id int64) (*Activity, error)

	// ListActivities returns activities matching the filter criteria.
	// Uses cursor-based pagination for efficient sequential access.
	// Used by: GET /activities
	ListActivities(ctx context.Context, filter ActivityListFilter) (*ActivityListResponse, error)
}
