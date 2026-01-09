package health

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
)

// mockRepo is a minimal mock for ActivityRepository
type mockRepo struct {
	pingErr error
}

func (m *mockRepo) Ping(ctx context.Context) error {
	return m.pingErr
}

// Implement other interface methods to satisfy ActivityRepository
func (m *mockRepo) Close() error { return nil }
func (m *mockRepo) GetActivityByID(ctx context.Context, id int64) (*repository.Activity, error) {
	return nil, nil
}
func (m *mockRepo) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*repository.ActivityListResponse, error) {
	return nil, nil
}
func (m *mockRepo) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*generated.SportMetrics, error) {
	return nil, nil
}
func (m *mockRepo) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.SportMetrics, error) {
	return nil, nil
}
func (m *mockRepo) GetYearMetadata(ctx context.Context, year int) (*generated.YearMetadata, error) {
	return nil, nil
}
func (m *mockRepo) GetDailySummary(ctx context.Context, year int, sportTypes []string) (*generated.DailySummary, error) {
	return nil, nil
}
func (m *mockRepo) GetDailySummaryByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.DailySummary, error) {
	return nil, nil
}

func TestHandler_Handle(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tests := []struct {
		name           string
		repo           repository.ActivityRepository
		expectedStatus int
		expectedBody   Response
	}{
		{
			name:           "Healthy database",
			repo:           &mockRepo{pingErr: nil},
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   statusHealthy,
				Database: statusHealthy,
			},
		},
		{
			name:           "Unhealthy database",
			repo:           &mockRepo{pingErr: errors.New("connection refused")},
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   statusHealthy,
				Database: statusUnhealthy,
			},
		},
		{
			name:           "Nil repository (no database)",
			repo:           nil,
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   statusHealthy,
				Database: "", // omitempty should make this disappear in JSON, but struct has it empty
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(tt.repo, logger)

			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			w := httptest.NewRecorder()

			h.Handle(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}

			var got Response
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("failed to unmarshal response: %v", err)
			}

			if got != tt.expectedBody {
				t.Errorf("response = %+v, want %+v", got, tt.expectedBody)
			}
		})
	}
}
