// Package repository defines domain interfaces for activity data access.
//
// This package contains ports in hexagonal architecture terms—interfaces that
// define what the domain needs from infrastructure, without specifying how.
// Implementations (adapters) live in packages like adapters/postgres.
//
// # ActivityRepository Interface
//
// The [ActivityRepository] interface defines all read operations for activities:
//
//	type ActivityRepository interface {
//	    Ping(ctx context.Context) error
//	    Close() error
//	    GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*generated.SportMetrics, error)
//	    GetDailySummary(ctx context.Context, year int, sportTypes []string) (*generated.DailySummary, error)
//	    // ... additional methods
//	}
//
// # Usage in Handlers
//
// Handlers receive the repository interface, not concrete implementations:
//
//	type ActivitiesHandler struct {
//	    repo repository.ActivityRepository
//	}
//
//	func (h *ActivitiesHandler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
//	    metrics, err := h.repo.GetSportMetrics(r.Context(), year, sportTypes)
//	    // ...
//	}
//
// # Filter Types
//
// [ActivityListFilter] specifies criteria for listing activities:
//
//	filter := repository.ActivityListFilter{
//	    Limit:  50,
//	    Cursor: "...",  // Optional: pagination cursor
//	}
//	activities, err := repo.ListActivities(ctx, filter)
//
// [ActivityCursor] is used internally for cursor-based pagination.
//
// # Implementations
//
// The PostgreSQL implementation is in adapters/postgres:
//
//	import "github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
//
//	pool, _ := postgres.NewPool(ctx, connString, logger, tracer)
//	repo := postgres.NewActivityRepository(pool, histogram, tracer)
package repository
