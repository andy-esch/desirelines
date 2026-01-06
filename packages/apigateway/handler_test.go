package apigateway_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/activities"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/health"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/sports"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
)

const (
	statusHealthy   = "healthy"
	statusUnhealthy = "unhealthy"
)

// mockAuthMiddleware is a no-op auth middleware for testing
type mockAuthMiddleware struct{}

func (m *mockAuthMiddleware) Middleware(next http.Handler) http.Handler {
	// Pass through without authentication (like local development mode)
	return next
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
	activity        *repository.Activity
	activityErr     error
	activityList    *repository.ActivityListResponse
	activityListErr error
}

func (m *mockActivityRepository) Ping(ctx context.Context) error {
	return m.pingErr
}

func (m *mockActivityRepository) Close() error {
	return m.closeErr
}

func (m *mockActivityRepository) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*generated.SportMetrics, error) {
	return m.sportMetrics, m.sportMetricsErr
}

func (m *mockActivityRepository) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.SportMetrics, error) {
	return m.sportMetrics, m.sportMetricsErr
}

func (m *mockActivityRepository) GetDailySummary(ctx context.Context, year int, sportTypes []string) (*generated.DailySummary, error) {
	return m.dailySummary, m.dailySummaryErr
}

func (m *mockActivityRepository) GetDailySummaryByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.DailySummary, error) {
	return m.dailySummary, m.dailySummaryErr
}

func (m *mockActivityRepository) GetYearMetadata(ctx context.Context, year int) (*generated.YearMetadata, error) {
	return m.yearMetadata, m.yearMetadataErr
}

func (m *mockActivityRepository) GetActivityByID(ctx context.Context, id int64) (*repository.Activity, error) {
	return m.activity, m.activityErr
}

func (m *mockActivityRepository) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*repository.ActivityListResponse, error) {
	return m.activityList, m.activityListErr
}

// Compile-time interface verification
var _ repository.ActivityRepository = (*mockActivityRepository)(nil)

// HealthResponse mirrors the health.Response type for test verification
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

// newTestRouter creates a router with mock dependencies for testing (no database)
func newTestRouter() http.Handler {
	return newTestRouterWithDB(nil)
}

// newTestRouterWithDB creates a router with mock database for testing
func newTestRouterWithDB(activityRepo repository.ActivityRepository) http.Handler {
	// Load sport config for tests (uses embedded config)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		panic("Failed to load sport config for tests: " + err.Error())
	}

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	// Create a mock auth middleware for testing
	mockAuth := &mockAuthMiddleware{}

	// Create feature handlers
	healthHandler := health.NewHandler(activityRepo)
	sportsHandler := sports.NewHandler()
	activitiesHandler := activities.NewHandler(activityRepo, sportConfig)

	// Configure and create router
	routerCfg := server.RouterConfig{
		CORSHandler:    corsHandler,
		AuthMiddleware: mockAuth,
	}

	publicRoutes := server.PublicRoutes{
		Health:      healthHandler.Handle,
		SportConfig: sportsHandler.HandleConfig,
	}

	authRoutes := server.AuthenticatedRoutes{
		GetMetadata:     activitiesHandler.HandleMetadata,
		GetMetrics:      activitiesHandler.HandleMetrics,
		GetSource:       activitiesHandler.HandleSource,
		ListActivities:  activitiesHandler.HandleListActivities,
		GetActivityByID: activitiesHandler.HandleGetActivity,
	}

	return server.NewRouter(routerCfg, publicRoutes, authRoutes)
}

func TestHandlerHealth(t *testing.T) {
	t.Run("without database", func(t *testing.T) {
		router := newTestRouter()

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

		// Parse response to verify database field is not present
		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != statusHealthy {
			t.Errorf("expected status %q, got %q", statusHealthy, response.Status)
		}

		if response.Database != "" {
			t.Errorf("expected empty database field without repository, got %q", response.Database)
		}
	})

	t.Run("with healthy database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{pingErr: nil}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != statusHealthy {
			t.Errorf("expected status %q, got %q", statusHealthy, response.Status)
		}

		if response.Database != statusHealthy {
			t.Errorf("expected database %q, got %q", statusHealthy, response.Database)
		}
	})

	t.Run("with unhealthy database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{pingErr: errors.New("connection refused")}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		// Health check should still return 200 (overall service is healthy)
		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response HealthResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.Status != statusHealthy {
			t.Errorf("expected status %q, got %q", statusHealthy, response.Status)
		}

		if response.Database != statusUnhealthy {
			t.Errorf("expected database %q, got %q", statusUnhealthy, response.Database)
		}
	})
}

func TestHandlerCORS(t *testing.T) {
	t.Run("preflight with allowed origin", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create router AFTER setting env var so CORS handler reads correct config
		router := newTestRouter()

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
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create router AFTER setting env var so CORS handler reads correct config
		router := newTestRouter()

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
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create router AFTER setting env var so CORS handler reads correct config
		router := newTestRouter()

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
		// Ensure ALLOWED_ORIGINS is not set
		t.Setenv("ALLOWED_ORIGINS", "")

		// Create router AFTER setting env var so CORS handler reads correct config
		router := newTestRouter()

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
	distance := 68400.0
	time := 120.0
	testMetrics := &generated.SportMetrics{
		Timeseries: []*generated.CumulativeMetricsEntry{
			{Date: "2024-01-15", Distance: &distance, Time: &time},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		router := newTestRouter() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=invalid", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Date range validation tests
	t.Run("valid date range", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("only from provided without to", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("only to provided without from", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("from date after to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2025-01-01&to=2024-12-15", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("date range exceeds maximum", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		// Request 2 years of data (exceeds 366 day limit)
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2023-01-01&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid from date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=invalid&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid to date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15&to=invalid", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerSource(t *testing.T) {
	distance := 8370.0
	time := 48.0
	testSummary := &generated.DailySummary{
		Daily: map[string]*generated.DailyActivity{
			"2024-01-15": {
				DistanceMeters: &distance,
				TimeMinutes:    &time,
				Activities:     1,
				ActivityIds:    []int64{12345},
			},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{dailySummary: testSummary}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		router := newTestRouter() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=badminton", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerMetadata(t *testing.T) {
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
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		router := newTestRouter() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})
}

func TestHandlerSportConfig(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
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
	elevation := 450.5
	testActivity := &repository.Activity{
		ID:                 12345678901,
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
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response repository.Activity
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if response.ID != testActivity.ID {
			t.Errorf("expected activity ID %d, got %d", testActivity.ID, response.ID)
		}
		if response.Name != testActivity.Name {
			t.Errorf("expected activity name %s, got %s", testActivity.Name, response.Name)
		}
	})

	t.Run("returns 404 for not found", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activity: nil} // Not found
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/99999999999", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid ID format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/not-a-number", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		router := newTestRouter() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityErr: errors.New("database error")}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})
}

func TestHandlerListActivities(t *testing.T) {
	elevation := 450.5
	testResponse := &repository.ActivityListResponse{
		Activities: []repository.ActivitySummary{
			{
				ID:                12345678901,
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
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response repository.ActivityListResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if len(response.Activities) != 1 {
			t.Errorf("expected 1 activity, got %d", len(response.Activities))
		}
	})

	t.Run("accepts date range parameters", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?from=2025-12-01&to=2025-12-28", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("accepts sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?sport=cycling", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("accepts limit parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?limit=50", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid from date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?from=not-a-date", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?to=not-a-date", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid sport", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?sport=badminton", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid limit", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?limit=999", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid cursor", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?cursor=not-valid-base64!!!", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		router := newTestRouter() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityListErr: errors.New("database error")}
		router := newTestRouterWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
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
