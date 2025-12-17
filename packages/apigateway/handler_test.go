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

func (m *mockActivityRepository) GetDailySummary(ctx context.Context, year int, sportTypes []string) (repository.DailySummary, error) {
	return m.dailySummary, m.dailySummaryErr
}

func (m *mockActivityRepository) GetYearMetadata(ctx context.Context, year int) (*repository.YearMetadata, error) {
	return m.yearMetadata, m.yearMetadataErr
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
