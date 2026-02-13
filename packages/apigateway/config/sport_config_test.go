package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// expectedSportCount is the number of sport categories in sport_types.json.
// Update this constant when adding/removing sports from the config.
// Current sports: cycling, ebike, running, walking, hiking, swimming, yoga,
// workout, watersports, winter_sports, golf, racket_sports, team_sports,
// skating, climbing, wheelchair
const expectedSportCount = 16

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
	if len(sports) != expectedSportCount {
		t.Errorf("Expected %d sports, got %d", expectedSportCount, len(sports))
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

// TestExcludedTypesLoaded verifies that excluded_types are properly loaded from config.
// Note: Go doesn't currently have a Matches() method like Python - excluded_types
// are loaded but filtering is done at the Python pipeline level. This test ensures
// the field is properly parsed for when/if Go needs to use it.
func TestExcludedTypesLoaded(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Cycling should have EBikeRide and EMountainBikeRide excluded
	cycling, ok := config.GetCategory("cycling")
	if !ok {
		t.Fatal("Expected cycling category to exist")
	}

	if len(cycling.ExcludedTypes) != 2 {
		t.Errorf("Expected cycling to have 2 excluded types, got %d", len(cycling.ExcludedTypes))
	}

	// Verify specific excluded types
	excludedMap := make(map[string]bool)
	for _, et := range cycling.ExcludedTypes {
		excludedMap[et] = true
	}

	if !excludedMap["EBikeRide"] {
		t.Error("Expected EBikeRide to be in cycling excluded_types")
	}
	if !excludedMap["EMountainBikeRide"] {
		t.Error("Expected EMountainBikeRide to be in cycling excluded_types")
	}

	// Running should have no excluded types
	running, ok := config.GetCategory("running")
	if !ok {
		t.Fatal("Expected running category to exist")
	}

	if len(running.ExcludedTypes) != 0 {
		t.Errorf("Expected running to have 0 excluded types, got %d", len(running.ExcludedTypes))
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
	err = os.WriteFile(configPath, data, 0o600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "unsupported sport config version: 99.0") {
		t.Errorf("Expected version validation error, got: %v", err)
	}
}

func TestInvalidSchemaFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	// Missing required field: StravaTypes
	invalidJSON := `{"version": "1.0", "sport_categories": {"cycling": {"display_name": "Cycling"}}}`
	err := os.WriteFile(configPath, []byte(invalidJSON), 0o600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error, got: %v", err)
	}
}

func TestGetCategoryForStravaType(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	tests := []struct {
		stravaType string
		want       string
	}{
		{"Ride", "cycling"},
		{"VirtualRide", "cycling"},
		{"GravelRide", "cycling"},
		{"MountainBikeRide", "cycling"},
		{"Run", "running"},
		{"TrailRun", "running"},
		{"VirtualRun", "running"},
		{"Yoga", "yoga"},
		{"Hike", "hiking"},
		{"Walk", "walking"},
		{"WeightTraining", "workout"},
		{"Swim", "swimming"},
		{"EBikeRide", "ebike"},
		{"UnknownSport", "UnknownSport"},
	}

	for _, tt := range tests {
		t.Run(tt.stravaType, func(t *testing.T) {
			got := config.GetCategoryForStravaType(tt.stravaType)
			if got != tt.want {
				t.Errorf("GetCategoryForStravaType(%q) = %q, want %q", tt.stravaType, got, tt.want)
			}
		})
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
	err = os.WriteFile(configPath, data, 0o600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error for empty strava_types, got: %v", err)
	}
}
