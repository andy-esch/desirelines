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

	// GetSportMetrics returns cumulative metrics timeseries for a sport in a given year.
	// Used by: GET /activities/{year}/metrics?sport=X
	GetSportMetrics(ctx context.Context, year int, sport string) (*SportMetrics, error)

	// GetDailySummary returns daily activity summaries for a sport in a given year.
	// Used by: GET /activities/{year}/source?sport=X
	GetDailySummary(ctx context.Context, year int, sport string) (DailySummary, error)

	// GetYearMetadata returns metadata about activities for a given year.
	// Used by: GET /activities/{year}/metadata
	GetYearMetadata(ctx context.Context, year int) (*YearMetadata, error)

	// GetDistances returns cumulative distance timeseries for cycling in a given year.
	// DEPRECATED: Legacy endpoint for backward compatibility.
	// Used by: GET /activities/{year}/distances
	GetDistances(ctx context.Context, year int) (*DistanceData, error)
}
