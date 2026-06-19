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
	"github.com/go-chi/chi/v5"
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
	pingErr         error
	closeErr        error
	sportMetrics    *generated.SportMetrics
	sportMetricsErr error
	dailySummary    *generated.DailySummary
	dailySummaryErr error
	yearMetadata    *generated.YearMetadata
	yearMetadataErr error
	activity        *activitiesv1.Activity
	activityErr     error
	activityList    *activitiesv1.ListActivitiesResponse
	activityListErr error
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
	return m.activityList, m.activityListErr
}

func (m *mockActivityRepository) GetNormalizedRoutes(ctx context.Context, userID string, limit int) ([]repository.NormalizedRoute, error) {
	return nil, nil
}

func (m *mockActivityRepository) GetRouteTile(ctx context.Context, userID string, z, x, y int) ([]byte, error) {
	return nil, nil
}

func (m *mockActivityRepository) GetRouteRegionSummary(ctx context.Context, userID string) ([]repository.RegionSummary, error) {
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
		GetMetadata:     activitiesHandler.HandleMetadata,
		GetMetrics:      activitiesHandler.HandleMetrics,
		GetSource:       activitiesHandler.HandleSource,
		GetRoutes:       activitiesHandler.HandleRoutes,
		GetRouteTile:    activitiesHandler.HandleRouteTile,
		GetRouteRegions: activitiesHandler.HandleRouteRegions,
		ListActivities:  activitiesHandler.HandleListActivities,
		GetActivityByID: activitiesHandler.HandleGetActivity,
	}

	return server.NewRouter(routerCfg, publicRoutes, authRoutes, logger)
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

	t.Run("accepts sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?sport=cycling", nil)
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

	t.Run("returns 400 for invalid sport", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo, []string{}, logger)

		req := httptest.NewRequest(http.MethodGet, "/v1/activities?sport=badminton", nil)
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
