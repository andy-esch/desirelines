package sports

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
)

// validConfigJSON is a minimal but realistic sport config matching the actual schema.
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

	// Create a temporary config file
	tmpFile, err := os.CreateTemp("", "sport_config_*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write([]byte(validConfigJSON)); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		t.Fatalf("Failed to close temp file: %v", err)
	}

	// Load the config
	sportConfig, err := config.NewSportConfig(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load sport config: %v", err)
	}

	h := NewHandler(logger, sportConfig)

	req := httptest.NewRequest(http.MethodGet, "/sports/config", nil)
	w := httptest.NewRecorder()

	h.HandleConfig(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	// Verify headers
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
	}

	cacheControl := w.Header().Get("Cache-Control")
	if cacheControl != "public, max-age=3600" {
		t.Errorf("Cache-Control = %q, want %q", cacheControl, "public, max-age=3600")
	}

	// Verify body
	var respConfig struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &respConfig); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if respConfig.Version != "1.0" {
		t.Errorf("version = %q, want %q", respConfig.Version, "1.0")
	}
}