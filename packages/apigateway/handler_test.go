package apigateway_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/activities"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/health"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/sports"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/proto"
	"gopkg.in/yaml.v3"
)

// Health status constants imported from health package for test assertions

// mockAuthMiddleware injects a test user ID into the request context.
// This simulates authenticated requests so handlers can extract the user ID.
type mockAuthMiddleware struct{}

func (m *mockAuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := middleware.WithUserID(r.Context(), "test-user")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// mockActivityRepository is a mock implementation of repository.ActivityRepository
type mockActivityRepository struct {
	pingErr             error
	closeErr            error
	sportMetrics        *generated.SportMetrics
	sportMetricsErr     error
	dailySummary        *generated.DailySummary
	dailySummaryErr     error
	yearMetadata        *generated.YearMetadata
	yearMetadataErr     error
	activity            *activitiesv1.Activity
	activityErr         error
	activityList        *activitiesv1.ListActivitiesResponse
	activityListErr     error
	lastListFilter      *repository.ActivityListFilter
	activityBuckets     []*activitiesv1.ActivityBucket
	activityBucketsErr  error
	lastAggregateFilter *repository.ActivityAggregateFilter
}

func (m *mockActivityRepository) Ping(ctx context.Context) error {
	return m.pingErr
}

func (m *mockActivityRepository) Close() error {
	return m.closeErr
}

func (m *mockActivityRepository) GetMultiSportMetrics(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.SportMetrics, error) {
	return nil, m.sportMetricsErr
}

func (m *mockActivityRepository) GetMultiSportMetricsByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.SportMetrics, error) {
	return nil, m.sportMetricsErr
}

func (m *mockActivityRepository) GetMultiSportDailySummary(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.DailySummary, error) {
	return nil, m.dailySummaryErr
}

func (m *mockActivityRepository) GetMultiSportDailySummaryByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.DailySummary, error) {
	return nil, m.dailySummaryErr
}

func (m *mockActivityRepository) GetYearMetadata(ctx context.Context, userID string, year int) (*generated.YearMetadata, error) {
	return m.yearMetadata, m.yearMetadataErr
}

func (m *mockActivityRepository) GetActivityByID(ctx context.Context, userID string, id int64) (*activitiesv1.Activity, error) {
	return m.activity, m.activityErr
}

func (m *mockActivityRepository) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error) {
	m.lastListFilter = &filter
	return m.activityList, m.activityListErr
}

func (m *mockActivityRepository) AggregateActivities(ctx context.Context, filter repository.ActivityAggregateFilter) ([]*activitiesv1.ActivityBucket, error) {
	m.lastAggregateFilter = &filter
	return m.activityBuckets, m.activityBucketsErr
}

func (m *mockActivityRepository) GetMapTile(ctx context.Context, userID string, z, x, y int) ([]byte, error) {
	return nil, nil
}

func (m *mockActivityRepository) GetMapRegionSummary(ctx context.Context, userID string) ([]repository.RegionSummary, error) {
	return nil, nil
}

func (m *mockActivityRepository) GetMapDataset(ctx context.Context, userID string) ([]*activitiesv1.MapActivity, error) {
	return nil, nil
}

// Compile-time interface verification
var _ repository.ActivityRepository = (*mockActivityRepository)(nil)

// HealthResponse mirrors the health.Response type for test verification
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

// newTestRouter creates a router with mock dependencies for testing (no database)
func newTestRouter(allowedOrigins []string, logger *slog.Logger) http.Handler {
	return newTestRouterWithDB(nil, allowedOrigins, logger)
}

// newTestRouterWithDB creates a router with mock database for testing
func newTestRouterWithDB(activityRepo repository.ActivityRepository, allowedOrigins []string, logger *slog.Logger) http.Handler {
	// Load sport config for tests (uses embedded config)
	sportConfig, err := config.NewSportConfig("")
	if err != nil {
		//nolint:forbidigo // test setup — embedded config failure means the test binary itself is broken, not a runtime error path
		panic(fmt.Sprintf("failed to load sport config for tests: %v", err))
	}

	// Initialize CORS handler
	corsHandler, err := cors.NewHandler(allowedOrigins, logger, false)
	if err != nil {
		//nolint:forbidigo // test setup — empty origins are acceptable in lax mode
		panic(fmt.Sprintf("failed to create CORS handler for tests: %v", err))
	}

	// Create a mock auth middleware for testing
	mockAuth := &mockAuthMiddleware{}

	// Create feature handlers. Zero retry backoff so failure-path tests don't
	// pay the production retry pause; retry behavior is covered in
	// internal/health/handler_test.go.
	healthHandler := health.NewHandlerWithOptions(activityRepo, logger, health.DefaultHealthCheckTimeout, 0)
	sportsHandler := sports.NewHandler(logger, sportConfig)
	activitiesHandler := activities.NewHandler(activityRepo, sportConfig, logger)

	// Configure and create router
	routerCfg := server.RouterConfig{
		CORSHandler:    corsHandler,
		AuthMiddleware: mockAuth,
	}

	noopHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	publicRoutes := server.PublicRoutes{
		Health:       healthHandler.HandleLive,
		Ready:        healthHandler.HandleReady,
		SportConfig:  sportsHandler.HandleConfig,
		AuthInitiate: noopHandler,
		AuthCallback: noopHandler,
	}

	authRoutes := server.AuthenticatedRoutes{
		GetMetadata:        activitiesHandler.HandleMetadata,
		GetMetrics:         activitiesHandler.HandleMetrics,
		GetSource:          activitiesHandler.HandleSource,
		GetMapTile:         activitiesHandler.HandleMapTile,
		GetMapRegions:      activitiesHandler.HandleMapRegions,
		GetMapDataset:      activitiesHandler.HandleMapDataset,
		ListActivities:     activitiesHandler.HandleListActivities,
		GetActivitySummary: activitiesHandler.HandleActivitySummary,
		GetActivityByID:    activitiesHandler.HandleGetActivity,
	}

	return server.NewRouter(routerCfg, publicRoutes, authRoutes, logger)
}

// TestTileRateLimitScopingAndCORS verifies the dual-profile rate-limit design:
//   - the bursty tile route is governed by its own limiter, not the global one;
//   - a tile 429 carries CORS headers (the tile limiter is scoped inside /v1,
//     after the root CORS middleware) so it surfaces truthfully cross-origin;
//   - non-tile JSON routes are unaffected by the tile limiter (scoping holds).
func TestTileRateLimitScopingAndCORS(t *testing.T) {
	logger := slog.Default()
	const origin = "http://localhost:3000"

	corsHandler, err := cors.NewHandler([]string{origin}, logger, false)
	if err != nil {
		t.Fatalf("cors handler: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Tile limiter that always rejects (burst 0) so we can assert the 429 path.
	tileLimiter := ratelimit.New(ctx, &ratelimit.Config{Rate: 0.001, Burst: 0}, logger)
	// Global limiter that never rejects but skips tiles — mirrors prod wiring, so
	// this also proves the global Skip hook routes tiles to the tile limiter.
	globalLimiter := ratelimit.New(ctx, &ratelimit.Config{
		Rate: 1000, Burst: 1000, Skip: server.IsTileRequest,
	}, logger)

	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	routerCfg := server.RouterConfig{
		CORSHandler:     corsHandler,
		AuthMiddleware:  &mockAuthMiddleware{},
		RateLimiter:     globalLimiter,
		TileRateLimiter: tileLimiter,
	}
	authRoutes := server.AuthenticatedRoutes{
		GetMetadata: ok, GetMetrics: ok, GetSource: ok,
		GetMapTile: ok, GetMapRegions: ok, GetMapDataset: ok,
		ListActivities: ok, GetActivityByID: ok,
	}
	publicRoutes := server.PublicRoutes{Health: ok, Ready: ok, SportConfig: ok, AuthInitiate: ok, AuthCallback: ok}
	router := server.NewRouter(routerCfg, publicRoutes, authRoutes, logger)

	send := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Origin", origin)
		req.RemoteAddr = "1.2.3.4:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	t.Run("tile 429 carries CORS headers", func(t *testing.T) {
		w := send("/v1/activities/map/tiles/9/1/2")
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("tile request: got %d, want 429", w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("tile 429 missing CORS header: got %q, want %q", got, origin)
		}
	})

	t.Run("non-tile JSON route is not tile-limited", func(t *testing.T) {
		w := send("/v1/activities/map/dataset")
		if w.Code != http.StatusOK {
			t.Fatalf("dataset request should not hit the tile limiter: got %d, want 200", w.Code)
		}
	})
}

func TestHandlerHealth(t *testing.T) {
	logger := slog.Default()

	// /health is liveness-only — never touches the DB. Even with an
	// "unhealthy" repo it should return 200 with no Database field.
	cases := []struct {
		name string
		repo repository.ActivityRepository
	}{
		{"without database", nil},
		{"with healthy database", &mockActivityRepository{pingErr: nil}},
		{"with unhealthy database", &mockActivityRepository{pingErr: errors.New("connection refused")}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			router := newTestRouterWithDB(tc.repo, []string{}, logger)

			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			contentType := w.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("expected Content-Type application/json, got %s", contentType)
			}

			var response HealthResponse
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatalf("failed to unmarshal response: %v", err)
			}

			if response.Status != health.StatusHealthy {
				t.Errorf("expected status %q, got %q", health.StatusHealthy, response.Status)
			}

			if response.Database != "" {
				t.Errorf("/health must not include database field (liveness-only), got %q", response.Database)
			}
		})
	}
}

func TestHandlerReady(t *testing.T) {
	logger := slog.Default()

	t.Run("without database", func(t *testing.T) {
		router := newTestRouter([]string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != health.StatusHealthy {
			t.Errorf("expected status %q, got %q", health.StatusHealthy, response.Status)
		}

		if response.Database != "" {
			t.Errorf("expected empty database field without repository, got %q", response.Database)
		}
	})

	t.Run("with healthy database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{pingErr: nil}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != health.StatusHealthy {
			t.Errorf("expected status %q, got %q", health.StatusHealthy, response.Status)
		}

		if response.Database != health.StatusHealthy {
			t.Errorf("expected database %q, got %q", health.StatusHealthy, response.Database)
		}
	})

	t.Run("with unhealthy database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{pingErr: errors.New("connection refused")}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}

		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != health.StatusUnhealthy {
			t.Errorf("expected status %q, got %q", health.StatusUnhealthy, response.Status)
		}

		if response.Database != health.StatusUnhealthy {
			t.Errorf("expected database %q, got %q", health.StatusUnhealthy, response.Database)
		}
	})
}

func TestHandlerCORS(t *testing.T) {
	logger := slog.Default()
	t.Run("preflight with allowed origin", func(t *testing.T) {
		origins := []string{"https://desirelines-dev.web.app", "http://localhost:5173"}
		router := newTestRouter(origins, logger)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://desirelines-dev.web.app")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", w.Code)
		}

		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "https://desirelines-dev.web.app" {
			t.Errorf("expected CORS origin to be https://desirelines-dev.web.app, got %s", allowedOrigin)
		}

		allowMethods := w.Header().Get("Access-Control-Allow-Methods")
		if allowMethods != "GET, OPTIONS" {
			t.Errorf("expected Allow-Methods to be GET, OPTIONS, got %s", allowMethods)
		}
	})

	t.Run("preflight with disallowed origin", func(t *testing.T) {
		origins := []string{"https://desirelines-dev.web.app", "http://localhost:5173"}
		router := newTestRouter(origins, logger)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://evil.com")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", w.Code)
		}

		// Should NOT set CORS header for disallowed origin
		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "" {
			t.Errorf("expected no CORS origin for disallowed origin, got %s", allowedOrigin)
		}
	})

	t.Run("localhost origin for dev", func(t *testing.T) {
		origins := []string{"https://desirelines-dev.web.app", "http://localhost:5173"}
		router := newTestRouter(origins, logger)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "http://localhost:5173" {
			t.Errorf("expected CORS origin to be http://localhost:5173, got %s", allowedOrigin)
		}
	})

	t.Run("no ALLOWED_ORIGINS env var blocks all origins", func(t *testing.T) {
		router := newTestRouter([]string{}, logger)

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://any-origin.com")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// Should NOT set any CORS header (secure by default)
		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "" {
			t.Errorf("expected no CORS origin when ALLOWED_ORIGINS not set, got %s", allowedOrigin)
		}
	})
}

func TestHandlerMetrics(t *testing.T) {
	logger := slog.Default()
	distance := 68400.0
	movingTime := 120.0
	testMetrics := &generated.SportMetrics{
		Timeseries: []*generated.CumulativeMetricsEntry{
			{Date: "2024-01-15", Distance: &distance, Time: &movingTime},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	// Note: "returns 503 without database" test removed - app now fails fast at startup if repo is nil

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=invalid", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Date range validation tests
	t.Run("valid date range", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=2024-12-15&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("only from provided without to", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=2024-12-15", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("only to provided without from", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("from date after to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=2025-01-01&to=2024-12-15", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("date range exceeds maximum", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		// Request 2 years of data (exceeds 366 day limit)
		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=2023-01-01&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid from date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=invalid&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid to date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metrics?sport=cycling&from=2024-12-15&to=invalid", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerSource(t *testing.T) {
	logger := slog.Default()
	distance := 8370.0
	movingMinutes := 48.0
	testSummary := &generated.DailySummary{
		Daily: map[string]*generated.DailyActivity{
			"2024-01-15": {
				DistanceMeters: &distance,
				TimeMinutes:    &movingMinutes,
				Activities:     1,
				ActivityIds:    []int64{12345},
			},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{dailySummary: testSummary}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	// Note: "returns 503 without database" test removed - app now fails fast at startup if repo is nil

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/source", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/source?sport=badminton", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerMetadata(t *testing.T) {
	logger := slog.Default()
	distance := 136800.0
	testMetadata := &generated.YearMetadata{
		Year:   2024,
		Sports: []string{"cycling", "running"},
		Totals: map[string]*generated.SportTotals{
			"cycling": {
				DistanceMeters: &distance,
				Activities:     4,
			},
		},
		AggregationVersion: "2.0",
	}

	t.Run("returns metadata successfully with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{yearMetadata: testMetadata}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	// Note: "returns 503 without database" test removed - app now fails fast at startup if repo is nil
}

func TestHandlerSportConfig(t *testing.T) {
	logger := slog.Default()
	router := newTestRouter([]string{}, logger)

	req := httptest.NewRequest(http.MethodGet, "/v1/sports/config", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Verify response contains sport categories
	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}

// =============================================================================
// Individual Activity Endpoint Tests
// =============================================================================

func TestHandlerGetActivity(t *testing.T) {
	logger := slog.Default()
	elevation := 450.5
	testActivity := &activitiesv1.Activity{
		Id:                 12345678901,
		Name:               "Morning Ride",
		Type:               "Ride",
		Sport:              "cycling",
		StartDateLocal:     "2025-12-28T08:30:00Z",
		DistanceMeters:     45678.9,
		MovingTimeSeconds:  5400,
		ElapsedTimeSeconds: 5800,
		ElevationMeters:    &elevation,
	}

	t.Run("returns activity successfully", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activity: testActivity}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/12345678901", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		// Just verify we get valid JSON response - detailed field checks would need protojson
		var response map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		// Check camelCase field names from protojson
		if response["id"] == nil {
			t.Error("expected id field in response")
		}
		if response["name"] != testActivity.Name {
			t.Errorf("expected activity name %s, got %v", testActivity.Name, response["name"])
		}
	})

	t.Run("returns 404 for not found", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activity: nil} // Not found
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/99999999999", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid ID format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/not-a-number", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Note: "returns 503 without database" test removed - app now fails fast at startup if repo is nil

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityErr: errors.New("database error")}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/12345678901", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})
}

func TestHandlerListActivities(t *testing.T) {
	logger := slog.Default()
	elevation := 450.5
	testResponse := &activitiesv1.ListActivitiesResponse{
		Activities: []*activitiesv1.ActivitySummary{
			{
				Id:                12345678901,
				Name:              "Morning Ride",
				Type:              "Ride",
				Sport:             "cycling",
				StartDateLocal:    "2025-12-28T08:30:00Z",
				DistanceMeters:    45678.9,
				MovingTimeSeconds: 5400,
				ElevationMeters:   &elevation,
			},
		},
		HasMore: false,
	}

	t.Run("returns activities successfully", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		// Just verify we get valid JSON response with camelCase fields
		var response map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		activityList, ok := response["activities"].([]interface{})
		if !ok {
			t.Fatal("expected activities to be an array")
		}
		if len(activityList) != 1 {
			t.Errorf("expected 1 activity, got %d", len(activityList))
		}
	})

	t.Run("accepts date range parameters", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?from=2025-12-01&to=2025-12-28", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("accepts limit parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?limit=50", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid from date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?from=not-a-date", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?to=not-a-date", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid limit", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?limit=999", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid cursor", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?cursor=not-valid-base64!!!", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Note: "returns 503 without database" test removed - app now fails fast at startup if repo is nil

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityListErr: errors.New("database error")}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})
}

func TestHandlerListActivitiesSportsFilter(t *testing.T) {
	logger := slog.Default()
	testResponse := &activitiesv1.ListActivitiesResponse{
		Activities: []*activitiesv1.ActivitySummary{
			{Id: 12345678901, Name: "Morning Ride", Type: "Ride", Sport: "cycling"},
		},
		HasMore: false,
	}
	sportConfig, err := config.NewSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}
	cyclingRunningUnion := slices.Concat(
		sportConfig.GetStravaTypes("cycling"), sportConfig.GetStravaTypes("running"))

	tests := []struct {
		name       string
		query      string
		wantStatus int
		// Expected repository filter on a 200 (nil = no sport filter).
		wantSportTypes []string
	}{
		{
			name:           "resolves sports categories to the union of their Strava types",
			query:          "?sports=cycling,running",
			wantStatus:     http.StatusOK,
			wantSportTypes: cyclingRunningUnion,
		},
		{
			name:           "skips empty entries in sports",
			query:          "?sports=cycling,,%20running",
			wantStatus:     http.StatusOK,
			wantSportTypes: cyclingRunningUnion,
		},
		{
			name:           "resolves a repeated category once",
			query:          "?sports=cycling,cycling,running",
			wantStatus:     http.StatusOK,
			wantSportTypes: cyclingRunningUnion,
		},
		{
			// Unlike the metrics endpoints (where sports is required and this
			// 400s), the list endpoint reads ",," as equivalent to absent.
			name:       "treats an all-empty sports list as no filter",
			query:      "?sports=,,",
			wantStatus: http.StatusOK,
		},
		{
			// A stale bundle from before the sports= switch sends sport=
			// (singular); it is an unknown param now: unfiltered, not an error.
			name:       "ignores the retired sport parameter",
			query:      "?sport=cycling",
			wantStatus: http.StatusOK,
		},
		{
			name:       "returns 400 for too many sports",
			query:      "?sports=" + strings.Repeat("cycling,", activities.MaxMultiSportCount) + "cycling",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "returns 400 for invalid sport",
			query:      "?sports=badminton",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "returns 400 when any sport in the list is invalid",
			query:      "?sports=cycling,badminton",
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockRepo := &mockActivityRepository{activityList: testResponse}
			router := newTestRouterWithDB(mockRepo, []string{}, logger)

			req := httptest.NewRequest(http.MethodGet, "/v1/activities"+tt.query, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, w.Code)
			}
			if tt.wantStatus != http.StatusOK {
				return
			}
			if mockRepo.lastListFilter == nil {
				t.Fatal("expected ListActivities to be called")
			}
			if got := mockRepo.lastListFilter.SportTypes; !slices.Equal(got, tt.wantSportTypes) {
				t.Errorf("expected SportTypes %v, got %v", tt.wantSportTypes, got)
			}
		})
	}
}

func TestHandlerActivitySummary(t *testing.T) {
	logger := slog.Default()
	sportConfig, err := config.NewSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}

	type bucketJSON struct {
		Month             string  `json:"month"`
		Sport             string  `json:"sport"`
		Geographic        bool    `json:"geographic"`
		Count             int32   `json:"count"`
		MovingTimeSeconds int32   `json:"movingTimeSeconds"`
		DistanceMeters    float64 `json:"distanceMeters"`
	}
	getBuckets := func(t *testing.T, body []byte) []bucketJSON {
		t.Helper()
		var response struct {
			Buckets []bucketJSON `json:"buckets"`
		}
		if jsonErr := json.Unmarshal(body, &response); jsonErr != nil {
			t.Fatalf("failed to unmarshal response: %v", jsonErr)
		}
		return response.Buckets
	}

	t.Run("merges raw sport_type buckets onto one category", func(t *testing.T) {
		// Ride and VirtualRide both map to cycling and must merge into one
		// (month, cycling, geographic) cell with summed measures.
		mockRepo := &mockActivityRepository{activityBuckets: []*activitiesv1.ActivityBucket{
			{Month: "2026-05", Sport: "Ride", Geographic: false, Count: 2, MovingTimeSeconds: 3600, DistanceMeters: 50000},
			{Month: "2026-05", Sport: "VirtualRide", Geographic: false, Count: 1, MovingTimeSeconds: 1800, DistanceMeters: 30000},
			{Month: "2026-05", Sport: "Run", Geographic: true, Count: 1, MovingTimeSeconds: 2400, DistanceMeters: 8000},
		}}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/summary", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		want := []bucketJSON{
			{Month: "2026-05", Sport: "cycling", Geographic: false, Count: 3, MovingTimeSeconds: 5400, DistanceMeters: 80000},
			{Month: "2026-05", Sport: "running", Geographic: true, Count: 1, MovingTimeSeconds: 2400, DistanceMeters: 8000},
		}
		if got := getBuckets(t, w.Body.Bytes()); !slices.Equal(got, want) {
			t.Errorf("expected buckets %+v, got %+v", want, got)
		}
	})

	t.Run("sorts merged buckets by month, sport, geographic", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityBuckets: []*activitiesv1.ActivityBucket{
			{Month: "2026-06", Sport: "Run", Geographic: true, Count: 1},
			{Month: "2026-05", Sport: "Yoga", Geographic: false, Count: 1},
			{Month: "2026-05", Sport: "Ride", Geographic: true, Count: 1},
			{Month: "2026-05", Sport: "VirtualRide", Geographic: false, Count: 1},
		}}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/summary", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		buckets := getBuckets(t, w.Body.Bytes())
		order := make([]string, 0, len(buckets))
		for _, b := range buckets {
			order = append(order, fmt.Sprintf("%s/%s/%t", b.Month, b.Sport, b.Geographic))
		}
		want := []string{
			"2026-05/cycling/false", "2026-05/cycling/true",
			"2026-05/yoga/false", "2026-06/running/true",
		}
		if !slices.Equal(order, want) {
			t.Errorf("expected order %v, got %v", want, order)
		}
	})

	t.Run("passes date and sports filters to the repository", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet,
			"/v1/activities/summary?from=2026-01-01&to=2026-06-30&sports=cycling", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		f := mockRepo.lastAggregateFilter
		if f == nil {
			t.Fatal("expected AggregateActivities to be called")
		}
		if f.From == nil || *f.From != "2026-01-01" || f.To == nil || *f.To != "2026-06-30" {
			t.Errorf("expected date filter 2026-01-01..2026-06-30, got %+v", f)
		}
		if !slices.Equal(f.SportTypes, sportConfig.GetStravaTypes("cycling")) {
			t.Errorf("expected cycling sport types, got %v", f.SportTypes)
		}
	})
}

func TestHandlerActivitySummaryErrors(t *testing.T) {
	logger := slog.Default()

	t.Run("returns 400 for an invalid date or sport", func(t *testing.T) {
		for _, query := range []string{"?from=not-a-date", "?to=2026-13-99", "?sports=badminton"} {
			mockRepo := &mockActivityRepository{}
			router := newTestRouterWithDB(mockRepo, []string{}, logger)

			req := httptest.NewRequest(http.MethodGet, "/v1/activities/summary"+query, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("%s: expected status 400, got %d", query, w.Code)
			}
		}
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityBucketsErr: errors.New("database error")}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities/summary", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})
}

// =============================================================================
// Validation Package Tests
// =============================================================================

func TestValidateYear(t *testing.T) {
	t.Run("valid year", func(t *testing.T) {
		if !validate.Year("2024") {
			t.Error("expected 2024 to be valid")
		}
	})

	t.Run("year at min boundary", func(t *testing.T) {
		if !validate.Year("2000") {
			t.Error("expected 2000 to be valid")
		}
	})

	t.Run("year at max boundary", func(t *testing.T) {
		if !validate.Year("2050") {
			t.Error("expected 2050 to be valid")
		}
	})

	t.Run("year below min", func(t *testing.T) {
		if validate.Year("1999") {
			t.Error("expected 1999 to be invalid")
		}
	})

	t.Run("year above max", func(t *testing.T) {
		if validate.Year("2051") {
			t.Error("expected 2051 to be invalid")
		}
	})

	t.Run("non-numeric year", func(t *testing.T) {
		if validate.Year("abcd") {
			t.Error("expected abcd to be invalid")
		}
	})

	t.Run("short year", func(t *testing.T) {
		if validate.Year("24") {
			t.Error("expected 24 to be invalid")
		}
	})
}

func TestValidateDate(t *testing.T) {
	t.Run("valid date", func(t *testing.T) {
		if !validate.Date("2025-12-28") {
			t.Error("expected 2025-12-28 to be valid")
		}
	})

	t.Run("invalid format", func(t *testing.T) {
		if validate.Date("12/28/2025") {
			t.Error("expected 12/28/2025 to be invalid")
		}
	})

	t.Run("invalid date", func(t *testing.T) {
		if validate.Date("2025-13-45") {
			t.Error("expected 2025-13-45 to be invalid")
		}
	})

	t.Run("empty string", func(t *testing.T) {
		if validate.Date("") {
			t.Error("expected empty string to be invalid")
		}
	})
}

// =============================================================================
// OpenAPI Spec Drift Detection
// =============================================================================

func TestRoutesMatchOpenAPISpec(t *testing.T) {
	logger := slog.Default()
	mockRepo := &mockActivityRepository{}
	router := newTestRouterWithDB(mockRepo, []string{}, logger)

	// Type assert to chi.Routes so we can walk the route tree
	chiRouter, ok := router.(chi.Routes)
	if !ok {
		t.Fatal("router does not implement chi.Routes")
	}

	registeredRoutes := collectRegisteredRoutes(t, chiRouter)
	specPaths := parseOpenAPISpec(t)

	verifyRegisteredRoutesInSpec(t, registeredRoutes, specPaths)
	verifySpecPathsInRouter(t, specPaths, registeredRoutes)
}

func collectRegisteredRoutes(t *testing.T, router chi.Routes) map[string]map[string]bool {
	registeredRoutes := make(map[string]map[string]bool)
	err := chi.Walk(router, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		// Ignore HEAD and OPTIONS methods automatically added by chi
		if method == http.MethodHead || method == http.MethodOptions {
			return nil
		}
		route = strings.TrimSuffix(route, "/*")
		if registeredRoutes[route] == nil {
			registeredRoutes[route] = make(map[string]bool)
		}
		registeredRoutes[route][method] = true
		return nil
	})
	if err != nil {
		t.Fatalf("failed to walk routes: %v", err)
	}
	return registeredRoutes
}

func parseOpenAPISpec(t *testing.T) map[string]map[string]bool {
	specData, err := os.ReadFile("openapi.yaml")
	if err != nil {
		t.Fatalf("failed to read openapi.yaml: %v", err)
	}

	var spec struct {
		Paths map[string]map[string]interface{} `yaml:"paths"`
	}
	err = yaml.Unmarshal(specData, &spec)
	if err != nil {
		t.Fatalf("failed to parse openapi.yaml: %v", err)
	}

	specPaths := make(map[string]map[string]bool)
	for path, methods := range spec.Paths {
		specPaths[path] = make(map[string]bool)
		for method := range methods {
			specPaths[path][strings.ToUpper(method)] = true
		}
	}
	return specPaths
}

func verifyRegisteredRoutesInSpec(t *testing.T, registeredRoutes, specPaths map[string]map[string]bool) {
	for route, methods := range registeredRoutes {
		specMethods, ok := specPaths[route]
		if !ok {
			t.Errorf("route registered in router but missing from openapi.yaml: %s", route)
			continue
		}
		for method := range methods {
			if !specMethods[method] {
				t.Errorf("method %s for route %s registered in router but missing from openapi.yaml", method, route)
			}
		}
	}
}

func verifySpecPathsInRouter(t *testing.T, specPaths, registeredRoutes map[string]map[string]bool) {
	for path, methods := range specPaths {
		registeredMethods, ok := registeredRoutes[path]
		if !ok {
			t.Errorf("path defined in openapi.yaml but not registered in router: %s", path)
			continue
		}
		for method := range methods {
			if !registeredMethods[method] {
				t.Errorf("method %s for path %s defined in openapi.yaml but not registered in router", method, path)
			}
		}
	}
}

func TestValidateDateRange(t *testing.T) {
	t.Run("valid range", func(t *testing.T) {
		if err := validate.DateRange("2024-12-15", "2025-01-01"); err != "" {
			t.Errorf("expected no error, got %s", err)
		}
	})

	t.Run("neither provided", func(t *testing.T) {
		if err := validate.DateRange("", ""); err != "" {
			t.Errorf("expected no error for empty dates, got %s", err)
		}
	})

	t.Run("only from provided", func(t *testing.T) {
		if err := validate.DateRange("2024-12-15", ""); err == "" {
			t.Error("expected error when only from provided")
		}
	})

	t.Run("only to provided", func(t *testing.T) {
		if err := validate.DateRange("", "2025-01-01"); err == "" {
			t.Error("expected error when only to provided")
		}
	})

	t.Run("from after to", func(t *testing.T) {
		if err := validate.DateRange("2025-01-01", "2024-12-15"); err == "" {
			t.Error("expected error when from after to")
		}
	})

	t.Run("range too large", func(t *testing.T) {
		if err := validate.DateRange("2023-01-01", "2025-01-01"); err == "" {
			t.Error("expected error for range > 366 days")
		}
	})
}

// TestOpenAPISchemaFieldsMatchProtoJSON guards the response-field half of the
// spec contract. TestRoutesMatchOpenAPISpec above compares paths and methods
// only, so nothing caught openapi.yaml documenting snake_case field names for
// years while the gateway marshals with protojson (UseProtoNames: false) and
// emits camelCase — a client generated from the spec looked for fields the API
// never returns. This asserts every documented property of a protobuf-backed
// schema is a real protojson field name.
//
// Only schemas served through respondProtobuf belong here. Responses built from
// hand-written Go structs (RegionSummary, HealthResponse, Error, SportCategory)
// are marshaled by encoding/json and follow their struct tags instead.
func TestOpenAPISchemaFieldsMatchProtoJSON(t *testing.T) {
	schemaMessages := map[string]proto.Message{
		"Activity":                    &activitiesv1.Activity{},
		"ActivitySummary":             &activitiesv1.ActivitySummary{},
		"ActivityListResponse":        &activitiesv1.ListActivitiesResponse{},
		"ActivityBucket":              &activitiesv1.ActivityBucket{},
		"AggregateActivitiesResponse": &activitiesv1.AggregateActivitiesResponse{},
		"MapActivity":                 &activitiesv1.MapActivity{},
		"YearMetadata":                &generated.YearMetadata{},
		"SportTotals":                 &generated.SportTotals{},
		"SportMetrics":                &generated.SportMetrics{},
		"CumulativeMetricsEntry":      &generated.CumulativeMetricsEntry{},
		"DailySummary":                &generated.DailySummary{},
		"DailyActivity":               &generated.DailyActivity{},
		"AllSportsMetrics":            &generated.AllSportsMetrics{},
		"AllSportsDailySummary":       &generated.AllSportsDailySummary{},
	}

	specData, err := os.ReadFile("openapi.yaml")
	if err != nil {
		t.Fatalf("failed to read openapi.yaml: %v", err)
	}
	var spec struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]interface{} `yaml:"properties"`
				Required   []string               `yaml:"required"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if unmarshalErr := yaml.Unmarshal(specData, &spec); unmarshalErr != nil {
		t.Fatalf("failed to parse openapi.yaml: %v", unmarshalErr)
	}

	for schemaName, msg := range schemaMessages {
		t.Run(schemaName, func(t *testing.T) {
			schema, ok := spec.Components.Schemas[schemaName]
			if !ok {
				t.Fatalf("openapi.yaml has no schema %q", schemaName)
			}

			// protojson (UseProtoNames: false) emits each field's JSON name.
			fields := msg.ProtoReflect().Descriptor().Fields()
			wire := make(map[string]bool, fields.Len())
			for i := range fields.Len() {
				wire[fields.Get(i).JSONName()] = true
			}

			for prop := range schema.Properties {
				if !wire[prop] {
					t.Errorf("schema documents %q, which is not a protojson field name (proto emits %v)",
						prop, sortedKeys(wire))
				}
			}
			for _, req := range schema.Required {
				if !wire[req] {
					t.Errorf("schema marks %q required, but it is not a protojson field name", req)
				}
			}
		})
	}
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}
