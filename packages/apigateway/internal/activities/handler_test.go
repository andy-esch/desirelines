package activities

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/go-chi/chi/v5"
)

// mockRepo is a minimal mock for unit tests that don't exercise repository methods.
// Tests here focus on validation logic (cursor decoding, year validation, etc.).
// For handler integration tests with actual repository interactions, see the
// more complete mockActivityRepository in handler_test.go (root package).
type mockRepo struct {
	err    error
	routes []repository.NormalizedRoute
}

func (m *mockRepo) Ping(ctx context.Context) error { return nil }
func (m *mockRepo) Close() error                   { return nil }
func (m *mockRepo) GetYearMetadata(ctx context.Context, userID string, year int) (*generated.YearMetadata, error) {
	return nil, m.err
}
func (m *mockRepo) GetMultiSportMetrics(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.SportMetrics, error) {
	return nil, m.err
}
func (m *mockRepo) GetMultiSportMetricsByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.SportMetrics, error) {
	return nil, m.err
}
func (m *mockRepo) GetMultiSportDailySummary(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.DailySummary, error) {
	return nil, m.err
}
func (m *mockRepo) GetMultiSportDailySummaryByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (map[string]*generated.DailySummary, error) {
	return nil, m.err
}
func (m *mockRepo) GetActivityByID(ctx context.Context, userID string, id int64) (*activitiesv1.Activity, error) {
	return nil, m.err
}
func (m *mockRepo) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error) {
	return nil, m.err
}
func (m *mockRepo) GetNormalizedRoutes(ctx context.Context, userID string, limit int) ([]repository.NormalizedRoute, error) {
	return m.routes, m.err
}

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	return newTestHandlerWithRepo(t, &mockRepo{})
}

func newTestHandlerWithRepo(t *testing.T, repo *mockRepo) *Handler {
	t.Helper()
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}
	return NewHandler(repo, sportConfig, slog.Default())
}

func TestDecodeCursor(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		wantTimestamp string
		wantID        int64
		wantErr       bool
	}{
		{
			name:          "valid cursor",
			input:         base64.URLEncoding.EncodeToString([]byte("2025-12-28T08:30:00Z|12345678901")),
			wantTimestamp: "2025-12-28T08:30:00Z",
			wantID:        12345678901,
			wantErr:       false,
		},
		{
			name:          "valid cursor with full RFC3339 timestamp",
			input:         base64.URLEncoding.EncodeToString([]byte("2025-01-01T12:00:00Z|999")),
			wantTimestamp: "2025-01-01T12:00:00Z",
			wantID:        999,
			wantErr:       false,
		},
		{
			name:    "invalid base64",
			input:   "not-valid-base64!!!",
			wantErr: true,
		},
		{
			name:    "valid base64 but missing pipe",
			input:   base64.URLEncoding.EncodeToString([]byte("no-pipe-separator")),
			wantErr: true,
		},
		{
			name:    "valid base64 but non-numeric ID",
			input:   base64.URLEncoding.EncodeToString([]byte("2025-01-01|not-a-number")),
			wantErr: true,
		},
		{
			name:    "valid base64 but invalid timestamp format",
			input:   base64.URLEncoding.EncodeToString([]byte("not-a-timestamp|123")),
			wantErr: true,
		},
		{
			name:    "empty string",
			input:   "",
			wantErr: true,
		},
		{
			name:    "pipe only (empty timestamp)",
			input:   base64.URLEncoding.EncodeToString([]byte("|123")),
			wantErr: true,
		},
		{
			name:    "zero ID rejected",
			input:   base64.URLEncoding.EncodeToString([]byte("2025-01-01T12:00:00Z|0")),
			wantErr: true,
		},
		{
			name:    "negative ID rejected",
			input:   base64.URLEncoding.EncodeToString([]byte("2025-01-01T12:00:00Z|-5")),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeCursor(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("decodeCursor() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err == nil {
				if got.Timestamp != tt.wantTimestamp {
					t.Errorf("decodeCursor() timestamp = %v, want %v", got.Timestamp, tt.wantTimestamp)
				}
				if got.ID != tt.wantID {
					t.Errorf("decodeCursor() ID = %v, want %v", got.ID, tt.wantID)
				}
			}
		})
	}
}

func TestHandler_validateAndGetYear(t *testing.T) {
	handler := newTestHandler(t)

	tests := []struct {
		name      string
		yearParam string
		wantOK    bool
		wantYear  string
	}{
		{"valid year 2024", "2024", true, "2024"},
		{"valid year 2000", "2000", true, "2000"},
		{"valid year 2050", "2050", true, "2050"},
		{"invalid year 1999", "1999", false, ""},
		{"invalid year 2051", "2051", false, ""},
		{"invalid format abc", "abc", false, ""},
		{"invalid format 20", "20", false, ""},
		{"empty", "", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create request with chi URL param
			req := httptest.NewRequest(http.MethodGet, "/activities/"+tt.yearParam+"/metadata", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("year", tt.yearParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			w := httptest.NewRecorder()

			gotYear, gotOK := handler.validateAndGetYear(w, req)
			if gotOK != tt.wantOK {
				t.Errorf("validateAndGetYear() ok = %v, want %v", gotOK, tt.wantOK)
			}
			if gotOK && gotYear != tt.wantYear {
				t.Errorf("validateAndGetYear() year = %v, want %v", gotYear, tt.wantYear)
			}
			if !gotOK && w.Code != http.StatusBadRequest {
				t.Errorf("validateAndGetYear() status = %v, want %v", w.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestHandler_validateAndGetSportTypes(t *testing.T) {
	handler := newTestHandler(t)

	tests := []struct {
		name       string
		sportParam string
		wantOK     bool
		wantTypes  []string // nil means we don't check types, just that it succeeded
	}{
		{"valid cycling", "cycling", true, nil},
		{"valid running", "running", true, nil},
		{"valid yoga", "yoga", true, nil},
		{"invalid sport", "badminton", false, nil},
		{"empty sport", "", false, nil},
		{"case sensitive", "Cycling", false, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := "/activities/2024/metrics"
			if tt.sportParam != "" {
				url += "?sport=" + tt.sportParam
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			w := httptest.NewRecorder()

			gotTypes, gotOK := handler.validateAndGetSportTypes(w, req)
			if gotOK != tt.wantOK {
				t.Errorf("validateAndGetSportTypes() ok = %v, want %v", gotOK, tt.wantOK)
			}
			if gotOK && len(gotTypes) == 0 {
				t.Error("validateAndGetSportTypes() returned empty types for valid sport")
			}
			if !gotOK && w.Code != http.StatusBadRequest {
				t.Errorf("validateAndGetSportTypes() status = %v, want %v", w.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestIsMultiSportRequest(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{"sports param present", "/activities/2024/metrics?sports=cycling,running", true},
		{"sport param only", "/activities/2024/metrics?sport=cycling", false},
		{"both params", "/activities/2024/metrics?sport=cycling&sports=cycling,running", true},
		{"no sport params", "/activities/2024/metrics", false},
		{"empty sports param", "/activities/2024/metrics?sports=", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			got := isMultiSportRequest(req)
			if got != tt.want {
				t.Errorf("isMultiSportRequest() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestHandler_validateMultiSportQuery(t *testing.T) {
	handler := newTestHandler(t)

	tests := []struct {
		name       string
		url        string
		yearParam  string
		wantNil    bool
		wantStatus int // only checked when wantNil is true
		wantSports int // number of sport categories expected
	}{
		{
			name:       "valid single sport",
			url:        "/activities/2024/metrics?sports=cycling",
			yearParam:  "2024",
			wantNil:    false,
			wantSports: 1,
		},
		{
			name:       "valid multiple sports",
			url:        "/activities/2024/metrics?sports=cycling,running,yoga",
			yearParam:  "2024",
			wantNil:    false,
			wantSports: 3,
		},
		{
			name:       "valid with date range",
			url:        "/activities/2024/metrics?sports=cycling,running&from=2024-01-01&to=2024-06-30",
			yearParam:  "2024",
			wantNil:    false,
			wantSports: 2,
		},
		{
			name:       "missing sports param",
			url:        "/activities/2024/metrics",
			yearParam:  "2024",
			wantNil:    true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid sport in list",
			url:        "/activities/2024/metrics?sports=cycling,badminton",
			yearParam:  "2024",
			wantNil:    true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty sports value",
			url:        "/activities/2024/metrics?sports=",
			yearParam:  "2024",
			wantNil:    true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "deduplicates sports",
			url:        "/activities/2024/metrics?sports=cycling,cycling",
			yearParam:  "2024",
			wantNil:    false,
			wantSports: 1, // map deduplicates
		},
		{
			name:       "trims whitespace",
			url:        "/activities/2024/metrics?sports=cycling,%20running",
			yearParam:  "2024",
			wantNil:    false,
			wantSports: 2, // TrimSpace makes " running" valid
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("year", tt.yearParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			w := httptest.NewRecorder()

			result := handler.validateMultiSportQuery(w, req)
			if tt.wantNil {
				if result != nil {
					t.Error("validateMultiSportQuery() should return nil")
				}
				if w.Code != tt.wantStatus {
					t.Errorf("validateMultiSportQuery() status = %v, want %v", w.Code, tt.wantStatus)
				}
			} else {
				if result == nil {
					t.Fatal("validateMultiSportQuery() returned nil unexpectedly")
					return
				}
				if len(result.sportCategories) != tt.wantSports {
					t.Errorf("validateMultiSportQuery() got %d categories, want %d", len(result.sportCategories), tt.wantSports)
				}
				// Verify each category has strava types
				for cat, types := range result.sportCategories {
					if len(types) == 0 {
						t.Errorf("category %q has no strava types", cat)
					}
				}
			}
		})
	}
}

// Test that the Handler struct implements expected constructor pattern
func TestNewHandler(t *testing.T) {
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}

	handler := NewHandler(&mockRepo{}, sportConfig, slog.Default())

	if handler == nil {
		t.Fatal("NewHandler returned nil")
		return
	}
	if handler.repo == nil {
		t.Error("Handler.repo is nil")
	}
	if handler.sportConfig == nil {
		t.Error("Handler.sportConfig is nil")
	}
	if handler.logger == nil {
		t.Error("Handler.logger is nil")
	}
}

func TestHandleRoutes(t *testing.T) {
	sampleRoutes := []repository.NormalizedRoute{
		{
			ActivityID: 1001,
			Name:       "Morning Ride",
			Sport:      "Ride",
			Distance:   15000.5,
			Date:       "2024-06-15",
			Coords:     [][]float64{{0.1, 0.2}, {0.3, 0.4}},
		},
		{
			ActivityID: 1002,
			Name:       "Evening Run",
			Sport:      "Run",
			Distance:   5000.0,
			Date:       "2024-06-16",
			Coords:     [][]float64{{0.0, 0.0}, {0.1, 0.1}},
		},
	}

	tests := []struct {
		name       string
		url        string
		userID     string
		mock       *mockRepo
		wantStatus int
		wantLen    int // expected number of routes in response; -1 to skip check
	}{
		{
			name:       "happy path with default limit",
			url:        "/activities/routes",
			userID:     "user-123",
			mock:       &mockRepo{routes: sampleRoutes},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
		{
			name:       "happy path with explicit limit",
			url:        "/activities/routes?limit=100",
			userID:     "user-123",
			mock:       &mockRepo{routes: sampleRoutes},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
		{
			name:       "empty results",
			url:        "/activities/routes",
			userID:     "user-123",
			mock:       &mockRepo{routes: []repository.NormalizedRoute{}},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:       "limit too high",
			url:        fmt.Sprintf("/activities/routes?limit=%d", repository.MaxRoutesLimit+1),
			userID:     "user-123",
			mock:       &mockRepo{},
			wantStatus: http.StatusBadRequest,
			wantLen:    -1,
		},
		{
			name:       "limit zero",
			url:        "/activities/routes?limit=0",
			userID:     "user-123",
			mock:       &mockRepo{},
			wantStatus: http.StatusBadRequest,
			wantLen:    -1,
		},
		{
			name:       "limit negative",
			url:        "/activities/routes?limit=-5",
			userID:     "user-123",
			mock:       &mockRepo{},
			wantStatus: http.StatusBadRequest,
			wantLen:    -1,
		},
		{
			name:       "limit not a number",
			url:        "/activities/routes?limit=abc",
			userID:     "user-123",
			mock:       &mockRepo{},
			wantStatus: http.StatusBadRequest,
			wantLen:    -1,
		},
		{
			name:       "missing user ID",
			url:        "/activities/routes",
			userID:     "",
			mock:       &mockRepo{},
			wantStatus: http.StatusInternalServerError,
			wantLen:    -1,
		},
		{
			name:       "database error",
			url:        "/activities/routes",
			userID:     "user-123",
			mock:       &mockRepo{err: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
			wantLen:    -1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newTestHandlerWithRepo(t, tt.mock)

			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			if tt.userID != "" {
				req = req.WithContext(middleware.WithUserID(req.Context(), tt.userID))
			}
			w := httptest.NewRecorder()

			handler.HandleRoutes(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}

			if tt.wantLen >= 0 {
				var routes []repository.NormalizedRoute
				if err := json.Unmarshal(w.Body.Bytes(), &routes); err != nil {
					t.Fatalf("failed to unmarshal response: %v", err)
				}
				if len(routes) != tt.wantLen {
					t.Errorf("got %d routes, want %d", len(routes), tt.wantLen)
				}
			}
		})
	}
}

func TestHandleRoutes_CacheHeader(t *testing.T) {
	handler := newTestHandlerWithRepo(t, &mockRepo{
		routes: []repository.NormalizedRoute{},
	})

	req := httptest.NewRequest(http.MethodGet, "/activities/routes", nil)
	req = req.WithContext(middleware.WithUserID(req.Context(), "user-123"))
	w := httptest.NewRecorder()

	handler.HandleRoutes(w, req)

	if cc := w.Header().Get("Cache-Control"); cc != "private, max-age=3600" {
		t.Errorf("Cache-Control = %q, want %q", cc, "private, max-age=3600")
	}
}

func TestHandleRoutes_SportCategoryMapping(t *testing.T) {
	handler := newTestHandlerWithRepo(t, &mockRepo{
		routes: []repository.NormalizedRoute{
			{ActivityID: 1, Sport: "Ride", Coords: [][]float64{{0, 0}}},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/activities/routes", nil)
	req = req.WithContext(middleware.WithUserID(req.Context(), "user-123"))
	w := httptest.NewRecorder()

	handler.HandleRoutes(w, req)

	var routes []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &routes); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}
	// "Ride" is a Strava type that maps to the "cycling" category
	sport, _ := routes[0]["sport"].(string)
	if sport == "Ride" {
		t.Error("sport should be mapped to category name, not raw Strava type")
	}
	if sport == "" {
		t.Error("sport category should not be empty")
	}
}
