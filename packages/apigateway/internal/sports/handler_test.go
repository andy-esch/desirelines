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
	t.Cleanup(func() {
		if cleanupErr := os.Remove(tmpFile.Name()); cleanupErr != nil {
			t.Logf("Failed to remove temp file %s: %v", tmpFile.Name(), cleanupErr)
		}
	})

	if _, writeErr := tmpFile.WriteString(validConfigJSON); writeErr != nil {
		t.Fatalf("Failed to write config: %v", writeErr)
	}
	if closeErr := tmpFile.Close(); closeErr != nil {
		t.Fatalf("Failed to close temp file: %v", closeErr)
	}

	// Load the config
	sportConfig, loadErr := config.NewSportConfig(tmpFile.Name())
	if loadErr != nil {
		t.Fatalf("Failed to load sport config: %v", loadErr)
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
	if unmarshalErr := json.Unmarshal(w.Body.Bytes(), &respConfig); unmarshalErr != nil {
		t.Fatalf("failed to unmarshal response: %v", unmarshalErr)
	}
	if respConfig.Version != "1.0" {
		t.Errorf("version = %q, want %q", respConfig.Version, "1.0")
	}
}
