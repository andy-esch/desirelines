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

	// Future query methods will be added incrementally:
	// GetActivity(ctx context.Context, id int64) (*Activity, error)
	// ListActivities(ctx context.Context, year int, sport string) ([]Activity, error)
}
