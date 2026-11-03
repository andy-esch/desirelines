// Package testutil provides test doubles shared by more than one apigateway test package.
//
// It follows packages/dispatcher/ports/portstest: configuration fields (canned results,
// errors) are set during test setup, before any concurrent access, and need no locking;
// state a mock records while it runs (filters it was called with, whether it ran) is
// guarded by a mutex and read through an accessor. Assert on the test goroutine.
//
// A double used by a single test file stays in that file.
package testutil

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
)

// ActivityRepository is a repository.ActivityRepository that returns canned results.
// The zero value answers every query with an empty result and no error.
//
// Err fails every query (not Ping or Close) that has no more specific error set, for a
// test that only needs the repository to be down.
type ActivityRepository struct {
	// Err is returned by any query whose own error field below is nil.
	Err error

	PingErr  error
	CloseErr error

	// SportMetrics and DailySummaries are keyed by Strava sport type ("Ride", "Run").
	SportMetrics      map[string]*generated.SportMetrics
	SportMetricsErr   error
	DailySummaries    map[string]*generated.DailySummary
	DailySummariesErr error

	YearMetadata    *generated.YearMetadata
	YearMetadataErr error

	Activity    *activitiesv1.Activity
	ActivityErr error

	ActivityList    *activitiesv1.ListActivitiesResponse
	ActivityListErr error

	ActivityBuckets    []*activitiesv1.ActivityBucket
	ActivityBucketsErr error

	MapTile          []byte
	MapRegionSummary []repository.RegionSummary
	MapDataset       []*activitiesv1.MapActivity

	mu                  sync.Mutex
	lastListFilter      *repository.ActivityListFilter
	lastAggregateFilter *repository.ActivityAggregateFilter
}

var _ repository.ActivityRepository = (*ActivityRepository)(nil)

// orErr returns specific when it's set, otherwise the repository-wide Err.
func (m *ActivityRepository) orErr(specific error) error {
	if specific != nil {
		return specific
	}
	return m.Err
}

// Ping returns PingErr.
func (m *ActivityRepository) Ping(context.Context) error { return m.PingErr }

// Close returns CloseErr.
func (m *ActivityRepository) Close() error { return m.CloseErr }

// GetMultiSportMetrics returns SportMetrics.
func (m *ActivityRepository) GetMultiSportMetrics(context.Context, string, int, []string, *time.Location) (map[string]*generated.SportMetrics, error) {
	return m.SportMetrics, m.orErr(m.SportMetricsErr)
}

// GetMultiSportMetricsByDateRange returns SportMetrics.
func (m *ActivityRepository) GetMultiSportMetricsByDateRange(context.Context, string, string, string, []string) (map[string]*generated.SportMetrics, error) {
	return m.SportMetrics, m.orErr(m.SportMetricsErr)
}

// GetMultiSportDailySummary returns DailySummaries.
func (m *ActivityRepository) GetMultiSportDailySummary(context.Context, string, int, []string, *time.Location) (map[string]*generated.DailySummary, error) {
	return m.DailySummaries, m.orErr(m.DailySummariesErr)
}

// GetMultiSportDailySummaryByDateRange returns DailySummaries.
func (m *ActivityRepository) GetMultiSportDailySummaryByDateRange(context.Context, string, string, string, []string) (map[string]*generated.DailySummary, error) {
	return m.DailySummaries, m.orErr(m.DailySummariesErr)
}

// GetYearMetadata returns YearMetadata.
func (m *ActivityRepository) GetYearMetadata(context.Context, string, int) (*generated.YearMetadata, error) {
	return m.YearMetadata, m.orErr(m.YearMetadataErr)
}

// GetActivityByID returns Activity.
func (m *ActivityRepository) GetActivityByID(context.Context, string, int64) (*activitiesv1.Activity, error) {
	return m.Activity, m.orErr(m.ActivityErr)
}

// ListActivities records the filter and returns ActivityList.
func (m *ActivityRepository) ListActivities(_ context.Context, filter repository.ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error) {
	m.mu.Lock()
	m.lastListFilter = &filter
	m.mu.Unlock()
	return m.ActivityList, m.orErr(m.ActivityListErr)
}

// AggregateActivities records the filter and returns ActivityBuckets.
func (m *ActivityRepository) AggregateActivities(_ context.Context, filter repository.ActivityAggregateFilter) ([]*activitiesv1.ActivityBucket, error) {
	m.mu.Lock()
	m.lastAggregateFilter = &filter
	m.mu.Unlock()
	return m.ActivityBuckets, m.orErr(m.ActivityBucketsErr)
}

// GetMapTile returns MapTile.
func (m *ActivityRepository) GetMapTile(context.Context, string, int, int, int) ([]byte, error) {
	return m.MapTile, m.Err
}

// GetMapRegionSummary returns MapRegionSummary.
func (m *ActivityRepository) GetMapRegionSummary(context.Context, string) ([]repository.RegionSummary, error) {
	return m.MapRegionSummary, m.Err
}

// GetMapDataset returns MapDataset.
func (m *ActivityRepository) GetMapDataset(context.Context, string) ([]*activitiesv1.MapActivity, error) {
	return m.MapDataset, m.Err
}

// LastListFilter is the filter ListActivities was last called with, or nil.
func (m *ActivityRepository) LastListFilter() *repository.ActivityListFilter {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastListFilter
}

// LastAggregateFilter is the filter AggregateActivities was last called with, or nil.
func (m *ActivityRepository) LastAggregateFilter() *repository.ActivityAggregateFilter {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastAggregateFilter
}

// AuthMiddleware stands in for the router's authentication middleware.
//
// With UserID set, it marks each request as signed in as that user. With Block set, it
// answers every request 401 before the handler runs.
type AuthMiddleware struct {
	UserID string
	Block  bool

	mu     sync.Mutex
	called bool
}

// server.AuthMiddleware's method set, checked here without importing internal/server:
// its own tests use this package, and Go rejects that import cycle.
var _ interface {
	Middleware(next http.Handler) http.Handler
} = (*AuthMiddleware)(nil)

// Middleware wraps next as configured.
func (m *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		m.called = true
		m.mu.Unlock()
		if m.Block {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if m.UserID != "" {
			r = r.WithContext(middleware.WithUserID(r.Context(), m.UserID))
		}
		next.ServeHTTP(w, r)
	})
}

// Called reports whether a request has passed through the middleware.
func (m *AuthMiddleware) Called() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.called
}
