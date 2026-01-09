package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateSport(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if !config.ValidateSport("cycling") {
		t.Error("Expected cycling to be valid")
	}

	if !config.ValidateSport("running") {
		t.Error("Expected running to be valid")
	}

	if !config.ValidateSport("yoga") {
		t.Error("Expected yoga to be valid")
	}

	if config.ValidateSport("underwater_basket_weaving") {
		t.Error("Expected underwater_basket_weaving to be invalid (not configured)")
	}
}

func TestGetCategory(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	cycling, ok := config.GetCategory("cycling")
	if !ok || cycling.PrimaryMetric != "distance_meters" {
		t.Error("Expected cycling with distance_meters primary")
	}

	if !cycling.HasDistance {
		t.Error("Expected cycling to have distance")
	}

	yoga, ok := config.GetCategory("yoga")
	if !ok || yoga.PrimaryMetric != "time_minutes" {
		t.Error("Expected yoga with time_minutes primary")
	}

	if yoga.HasDistance {
		t.Error("Expected yoga to not have distance")
	}
}

func TestListSports(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	sports := config.ListSports()
	if len(sports) != 16 {
		t.Errorf("Expected 16 sports, got %d", len(sports))
	}

	// Check all expected sports are present
	sportMap := make(map[string]bool)
	for _, sport := range sports {
		sportMap[sport] = true
	}

	if !sportMap["cycling"] || !sportMap["running"] || !sportMap["yoga"] {
		t.Error("Expected cycling, running, and yoga in sports list")
	}
}

func TestUnsupportedVersionFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	configData := SportConfigData{
		Version: "99.0",
		SportCategories: map[string]SportCategory{
			"cycling": {
				DisplayName:   "Cycling",
				StravaTypes:   []string{"Ride"},
				PrimaryMetric: "distance_meters",
				Metrics:       []string{"distance_meters"},
				HasDistance:   true,
				HasElevation:  true,
			},
		},
	}
	data, err := json.Marshal(configData)
	if err != nil {
		t.Fatalf("Failed to marshal test config: %v", err)
	}
	err = os.WriteFile(configPath, data, 0600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = loadSportConfigInternal(configPath)
	if err == nil || !strings.Contains(err.Error(), "unsupported sport config version: 99.0") {
		t.Errorf("Expected version validation error, got: %v", err)
	}
}

func TestInvalidSchemaFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	// Missing required field: StravaTypes
	invalidJSON := `{"version": "1.0", "sport_categories": {"cycling": {"display_name": "Cycling"}}}`
	err := os.WriteFile(configPath, []byte(invalidJSON), 0600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = loadSportConfigInternal(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error, got: %v", err)
	}
}

func TestEmptyStravaTypesFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	configData := SportConfigData{
		Version: "1.0",
		SportCategories: map[string]SportCategory{
			"cycling": {
				DisplayName:   "Cycling",
				StravaTypes:   []string{}, // Empty list should fail
				PrimaryMetric: "distance_meters",
				Metrics:       []string{"distance_meters"},
				HasDistance:   true,
				HasElevation:  true,
			},
		},
	}
	data, err := json.Marshal(configData)
	if err != nil {
		t.Fatalf("Failed to marshal test config: %v", err)
	}
	err = os.WriteFile(configPath, data, 0600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = loadSportConfigInternal(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error for empty strava_types, got: %v", err)
	}
}
