package postgres

import (
	"context"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

// ActivityRepository implements repository.ActivityRepository for PostgreSQL.
// This is an adapter in hexagonal architecture - infrastructure layer.
type ActivityRepository struct {
	pool *Pool
}

// Compile-time interface verification
var _ repository.ActivityRepository = (*ActivityRepository)(nil)

// NewActivityRepository creates a PostgreSQL activity repository.
func NewActivityRepository(pool *Pool) *ActivityRepository {
	return &ActivityRepository{pool: pool}
}

// Ping verifies database connectivity.
func (r *ActivityRepository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

// Close releases all database resources.
func (r *ActivityRepository) Close() error {
	r.pool.Close()
	return nil
}

// Future query methods will be added here as needed:
// - GetActivity(ctx, id) (*Activity, error)
// - ListActivities(ctx, year, sport) ([]Activity, error)
