package apigateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
	"github.com/go-chi/chi/v5"
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
	sportMetrics    *repository.SportMetrics
	sportMetricsErr error
	dailySummary    repository.DailySummary
	dailySummaryErr error
	yearMetadata    *repository.YearMetadata
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

func (m *mockActivityRepository) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*repository.SportMetrics, error) {
	return m.sportMetrics, m.sportMetricsErr
}

func (m *mockActivityRepository) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*repository.SportMetrics, error) {
	return m.sportMetrics, m.sportMetricsErr
}

func (m *mockActivityRepository) GetDailySummary(ctx context.Context, year int, sportTypes []string) (repository.DailySummary, error) {
	return m.dailySummary, m.dailySummaryErr
}

func (m *mockActivityRepository) GetYearMetadata(ctx context.Context, year int) (*repository.YearMetadata, error) {
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

// newTestHandler creates a handler with mock dependencies for testing (no database)
func newTestHandler() *Handler {
	return newTestHandlerWithDB(nil)
}

// newTestHandlerWithDB creates a handler with mock database for testing
func newTestHandlerWithDB(activityRepo repository.ActivityRepository) *Handler {
	// Load sport config for tests (uses embedded config)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		panic("Failed to load sport config for tests: " + err.Error())
	}

	// Create a mock auth middleware for testing
	mockAuth := &mockAuthMiddleware{}

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	// Initialize chi router
	r := chi.NewRouter()

	h := &Handler{
		activityRepo:   activityRepo,
		authMiddleware: mockAuth,
		corsHandler:    corsHandler,
		router:         r,
		sportConfig:    sportConfig,
	}

	// Register routes
	h.registerRoutes()

	return h
}

func TestHandlerHealth(t *testing.T) {
	t.Run("without database", func(t *testing.T) {
		handler := newTestHandler()

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		contentType := w.Header().Get("Content-Type")
		if contentType != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", contentType)
		}

		// Parse response to verify database field is not present
		var response types.HealthResponse
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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response types.HealthResponse
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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		// Health check should still return 200 (overall service is healthy)
		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response types.HealthResponse
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

func TestHandlerClose(t *testing.T) {
	t.Run("without database", func(t *testing.T) {
		handler := newTestHandler()

		err := handler.Close()
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
	})

	t.Run("with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		err := handler.Close()
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
	})

	t.Run("with database close error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{closeErr: errors.New("close failed")}
		handler := newTestHandlerWithDB(mockRepo)

		err := handler.Close()
		if err == nil {
			t.Error("expected error, got nil")
		}
	})
}

func TestHandlerCORS(t *testing.T) {
	t.Run("preflight with allowed origin", func(t *testing.T) {
		// Set environment variable for this test
		t.Setenv("ALLOWED_ORIGINS", "https://desirelines-dev.web.app,http://localhost:5173")

		// Create handler AFTER setting env var so CORS handler reads correct config
		handler := newTestHandler()

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://desirelines-dev.web.app")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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

		// Create handler AFTER setting env var so CORS handler reads correct config
		handler := newTestHandler()

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://evil.com")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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

		// Create handler AFTER setting env var so CORS handler reads correct config
		handler := newTestHandler()

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		allowedOrigin := w.Header().Get("Access-Control-Allow-Origin")
		if allowedOrigin != "http://localhost:5173" {
			t.Errorf("expected CORS origin to be http://localhost:5173, got %s", allowedOrigin)
		}
	})

	t.Run("no ALLOWED_ORIGINS env var blocks all origins", func(t *testing.T) {
		// Ensure ALLOWED_ORIGINS is not set
		t.Setenv("ALLOWED_ORIGINS", "")

		// Create handler AFTER setting env var so CORS handler reads correct config
		handler := newTestHandler()

		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://any-origin.com")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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
	testMetrics := &repository.SportMetrics{
		Timeseries: []repository.CumulativeMetricsEntry{
			{Date: "2024-01-15", Distance: &distance, Time: &time},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		handler := newTestHandler() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=invalid", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	// Date range validation tests
	t.Run("valid date range", func(t *testing.T) {
		mockRepo := &mockActivityRepository{sportMetrics: testMetrics}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("only from provided without to", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("only to provided without from", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("from date after to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2025-01-01&to=2024-12-15", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("date range exceeds maximum", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		// Request 2 years of data (exceeds 366 day limit)
		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2023-01-01&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid from date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=invalid&to=2025-01-01", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid to date format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metrics?sport=cycling&from=2024-12-15&to=invalid", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerSource(t *testing.T) {
	distance := 8370.0
	time := 48.0
	testSummary := repository.DailySummary{
		"2024-01-15": &repository.DailyActivity{
			DistanceMeters: &distance,
			TimeMinutes:    &time,
			Activities:     1,
			ActivityIDs:    []int64{12345},
		},
	}

	t.Run("valid sport parameter with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{dailySummary: testSummary}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		handler := newTestHandler() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=running", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("missing sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("invalid sport name", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/source?sport=badminton", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}

func TestHandlerMetadata(t *testing.T) {
	distance := 136800.0
	testMetadata := &repository.YearMetadata{
		Year:   2024,
		Sports: []string{"cycling", "running"},
		Totals: map[string]*repository.SportTotals{
			"cycling": {
				DistanceMeters: &distance,
				Activities:     4,
			},
		},
		AggregationVersion: "2.0",
	}

	t.Run("returns metadata successfully with database", func(t *testing.T) {
		mockRepo := &mockActivityRepository{yearMetadata: testMetadata}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		handler := newTestHandler() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/2024/metadata", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})
}

func TestHandlerSportConfig(t *testing.T) {
	handler := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/99999999999", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid ID format", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/not-a-number", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		handler := newTestHandler() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityErr: errors.New("database error")}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities/12345678901", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

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
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?from=2025-12-01&to=2025-12-28", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("accepts sport parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?sport=cycling", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("accepts limit parameter", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityList: testResponse}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?limit=50", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid from date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?from=not-a-date", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid to date", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?to=not-a-date", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid sport", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?sport=badminton", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid limit", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?limit=999", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 400 for invalid cursor", func(t *testing.T) {
		mockRepo := &mockActivityRepository{}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities?cursor=not-valid-base64!!!", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("returns 503 without database", func(t *testing.T) {
		handler := newTestHandler() // No database

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", w.Code)
		}
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		mockRepo := &mockActivityRepository{activityListErr: errors.New("database error")}
		handler := newTestHandlerWithDB(mockRepo)

		req := httptest.NewRequest(http.MethodGet, "/activities", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("expected status 500, got %d", w.Code)
		}
	})
}

func TestDecodeCursor(t *testing.T) {
	t.Run("decodes valid cursor", func(t *testing.T) {
		// Encode a cursor: "2025-12-28T08:30:00Z|12345678901"
		encoded := "MjAyNS0xMi0yOFQwODozMDowMFp8MTIzNDU2Nzg5MDE="

		cursor, err := decodeCursor(encoded)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if cursor.Timestamp != "2025-12-28T08:30:00Z" {
			t.Errorf("expected timestamp '2025-12-28T08:30:00Z', got '%s'", cursor.Timestamp)
		}
		if cursor.ID != 12345678901 {
			t.Errorf("expected ID 12345678901, got %d", cursor.ID)
		}
	})

	t.Run("returns error for invalid base64", func(t *testing.T) {
		_, err := decodeCursor("not-valid-base64!!!")
		if err == nil {
			t.Error("expected error for invalid base64")
		}
	})

	t.Run("returns error for invalid format", func(t *testing.T) {
		// Valid base64 but missing pipe separator
		encoded := "bm8tcGlwZS1zZXBhcmF0b3I=" // "no-pipe-separator"

		_, err := decodeCursor(encoded)
		if err == nil {
			t.Error("expected error for invalid cursor format")
		}
	})
}

func TestIsValidDate(t *testing.T) {
	t.Run("valid date", func(t *testing.T) {
		if !isValidDate("2025-12-28") {
			t.Error("expected 2025-12-28 to be valid")
		}
	})

	t.Run("invalid format", func(t *testing.T) {
		if isValidDate("12/28/2025") {
			t.Error("expected 12/28/2025 to be invalid")
		}
	})

	t.Run("invalid date", func(t *testing.T) {
		if isValidDate("2025-13-45") {
			t.Error("expected 2025-13-45 to be invalid")
		}
	})

	t.Run("empty string", func(t *testing.T) {
		if isValidDate("") {
			t.Error("expected empty string to be invalid")
		}
	})
}
