package activities

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/go-chi/chi/v5"
)

// mockRepo implements repository.ActivityRepository for testing
type mockRepo struct {
	sportMetrics *repository.SportMetrics
	err          error
}

func (m *mockRepo) Ping(ctx context.Context) error { return nil }
func (m *mockRepo) Close() error                   { return nil }
func (m *mockRepo) GetYearMetadata(ctx context.Context, year int) (*repository.YearMetadata, error) {
	return nil, m.err
}
func (m *mockRepo) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*repository.SportMetrics, error) {
	return m.sportMetrics, m.err
}
func (m *mockRepo) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*repository.SportMetrics, error) {
	return m.sportMetrics, m.err
}
func (m *mockRepo) GetDailySummary(ctx context.Context, year int, sportTypes []string) (repository.DailySummary, error) {
	return nil, m.err
}
func (m *mockRepo) GetActivityByID(ctx context.Context, id int64) (*repository.Activity, error) {
	return nil, m.err
}
func (m *mockRepo) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*repository.ActivityListResponse, error) {
	return nil, m.err
}

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}
	return NewHandler(&mockRepo{}, sportConfig)
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

func TestHandler_nilRepoReturns503(t *testing.T) {
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		t.Fatalf("failed to load sport config: %v", err)
	}

	// Handler with nil repository
	handler := NewHandler(nil, sportConfig)

	tests := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"HandleMetadata", http.MethodGet, "/activities/2024/metadata", handler.HandleMetadata},
		{"HandleMetrics", http.MethodGet, "/activities/2024/metrics?sport=cycling", handler.HandleMetrics},
		{"HandleSource", http.MethodGet, "/activities/2024/source?sport=cycling", handler.HandleSource},
		{"HandleGetActivity", http.MethodGet, "/activities/123", handler.HandleGetActivity},
		{"HandleListActivities", http.MethodGet, "/activities", handler.HandleListActivities},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)

			// Add chi context for routes that need URL params
			rctx := chi.NewRouteContext()
			if tt.name == "HandleMetadata" || tt.name == "HandleMetrics" || tt.name == "HandleSource" {
				rctx.URLParams.Add("year", "2024")
			}
			if tt.name == "HandleGetActivity" {
				rctx.URLParams.Add("id", "123")
			}
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			w := httptest.NewRecorder()
			tt.handler(w, req)

			if w.Code != http.StatusServiceUnavailable {
				t.Errorf("%s with nil repo: got status %d, want %d", tt.name, w.Code, http.StatusServiceUnavailable)
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

	handler := NewHandler(&mockRepo{}, sportConfig)

	if handler == nil {
		t.Fatal("NewHandler returned nil")
	}
	if handler.repo == nil {
		t.Error("Handler.repo is nil")
	}
	if handler.sportConfig == nil {
		t.Error("Handler.sportConfig is nil")
	}
}
