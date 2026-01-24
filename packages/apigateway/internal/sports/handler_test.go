package sports

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// validConfigJSON is a minimal but realistic sport config matching the actual schema.
// This ensures tests validate real behavior, not just JSON passthrough.
const validConfigJSON = `{
  "version": "1.0",
  "sport_categories": {
    "cycling": {
      "display_name": "Cycling",
      "strava_types": ["Ride", "VirtualRide"],
      "excluded_types": ["EBikeRide"],
      "primary_metric": "distance_meters",
      "metrics": ["distance_meters", "time_minutes"],
      "has_distance": true,
      "has_elevation": true
    },
    "running": {
      "display_name": "Running",
      "strava_types": ["Run"],
      "excluded_types": [],
      "primary_metric": "distance_meters",
      "metrics": ["distance_meters", "time_minutes"],
      "has_distance": true,
      "has_elevation": true
    }
  }
}`

func TestHandler_HandleConfig(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tests := []struct {
		name           string
		mockConfig     func() []byte
		expectedStatus int
		checkError     bool
		validateJSON   func(t *testing.T, body []byte) // Custom validation for success cases
	}{
		{
			name: "valid config returns correct structure",
			mockConfig: func() []byte {
				return []byte(validConfigJSON)
			},
			expectedStatus: http.StatusOK,
			validateJSON: func(t *testing.T, body []byte) {
				// Verify it's valid JSON that matches expected schema
				var config struct {
					Version         string `json:"version"`
					SportCategories map[string]struct {
						DisplayName   string   `json:"display_name"`
						StravaTypes   []string `json:"strava_types"`
						ExcludedTypes []string `json:"excluded_types"`
						PrimaryMetric string   `json:"primary_metric"`
						Metrics       []string `json:"metrics"`
						HasDistance   bool     `json:"has_distance"`
						HasElevation  bool     `json:"has_elevation"`
					} `json:"sport_categories"`
				}
				if err := json.Unmarshal(body, &config); err != nil {
					t.Fatalf("failed to unmarshal config: %v", err)
				}
				if config.Version != "1.0" {
					t.Errorf("version = %q, want %q", config.Version, "1.0")
				}
				if len(config.SportCategories) != 2 {
					t.Errorf("sport_categories count = %d, want 2", len(config.SportCategories))
				}
				cycling, ok := config.SportCategories["cycling"]
				if !ok {
					t.Fatal("expected cycling category")
				}
				if cycling.PrimaryMetric != "distance_meters" {
					t.Errorf("cycling.primary_metric = %q, want %q", cycling.PrimaryMetric, "distance_meters")
				}
			},
		},
		{
			name: "empty config returns internal server error",
			mockConfig: func() []byte {
				return []byte{}
			},
			expectedStatus: http.StatusInternalServerError,
			checkError:     true,
		},
		{
			name: "invalid JSON returns internal server error",
			mockConfig: func() []byte {
				return []byte(`{invalid-json`)
			},
			expectedStatus: http.StatusInternalServerError,
			checkError:     true,
		},
		{
			name: "nil bytes returns internal server error",
			mockConfig: func() []byte {
				return nil
			},
			expectedStatus: http.StatusInternalServerError,
			checkError:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &Handler{
				logger:         logger,
				configProvider: tt.mockConfig,
			}

			req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
			w := httptest.NewRecorder()

			h.HandleConfig(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}

			if tt.checkError {
				var errResp gcplog.ErrorResponse
				if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
					t.Fatalf("failed to unmarshal error response: %v", err)
				}
				if errResp.Error == "" {
					t.Error("expected error message in response")
				}
			} else if tt.validateJSON != nil {
				tt.validateJSON(t, w.Body.Bytes())
			}
		})
	}
}

// TestHandler_HandleConfig_ContentType verifies the response has correct Content-Type header.
func TestHandler_HandleConfig_ContentType(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := &Handler{
		logger: logger,
		configProvider: func() []byte {
			return []byte(validConfigJSON)
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
	w := httptest.NewRecorder()

	h.HandleConfig(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
	}
}
