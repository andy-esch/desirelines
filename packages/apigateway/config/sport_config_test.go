package config

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// expectedSportCount is the number of sport categories in sport_types.json.
// Update this constant when adding/removing sports from the config.
// Current sports: cycling, ebike, running, walking, hiking, swimming, yoga,
// workout, watersports, winter_sports, golf, racket_sports, team_sports,
// skating, climbing, wheelchair, other
const expectedSportCount = 17

// Frozen before the registry reshape: expectations must not follow the new
// registry automatically, or a changed mapping/metadata value would pass silently.
func TestPublicConfigPreservesV1AndAllStravaMappings(t *testing.T) {
	c, err := NewSportConfig("")
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := os.ReadFile("../../../schemas/sports/testdata/config-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var want, got any
	if err = json.Unmarshal(baseline, &want); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(c.APIJSON(), &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("public config changed from the frozen version-1.0 contract")
	}
	var legacy struct {
		SportCategories map[string]struct {
			StravaTypes []string `json:"stravaTypes"`
		} `json:"sportCategories"`
	}
	if err = json.Unmarshal(baseline, &legacy); err != nil {
		t.Fatal(err)
	}
	for category, metadata := range legacy.SportCategories {
		if !reflect.DeepEqual(c.GetStravaTypes(category), metadata.StravaTypes) {
			t.Errorf("changed query types for %s", category)
		}
		for _, sportType := range metadata.StravaTypes {
			if got := c.GetCategoryForStravaType(sportType); got != category {
				t.Errorf("%s: got %s, want %s", sportType, got, category)
			}
		}
	}
}

func TestRegistryRejectsMissingOrUnsupportedVocabulary(t *testing.T) {
	for _, mapping := range []string{
		`null`,
		`{}`,
		`{"strava.type":{"types":["Ride"]}}`,
		`{"strava.sport_type":{"types":["Ride"]},"intervals_icu.type":{"types":["Run"]}}`,
		`{"strava.sport_type":{"types":[]}}`,
		`{"strava.sport_type":{"types":[""]}}`,
	} {
		t.Run(mapping, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.json")
			data := `{"version":"2.0","sportCategories":{"cycling":{"displayName":"Cycling","primaryMetric":"distance_meters","metrics":["distance_meters"],"mappings":` + mapping + `}}}`
			if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewSportConfig(path); err == nil {
				t.Fatal("expected invalid mapping to fail at load")
			}
		})
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

// TestExcludedTypesLoaded verifies that vocabulary exclusions are loaded from config.
// Go retains exclusions for the compatible public response; its query membership
// continues to use the existing positive type lists.
func TestExcludedTypesLoaded(t *testing.T) {
	config, err := LoadSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Cycling should have EBikeRide and EMountainBikeRide excluded
	cycling, ok := config.data.SportCategories["cycling"]
	if !ok {
		t.Fatal("Expected cycling category to exist")
	}

	if len(cycling.Mappings[stravaSportTypeVocabulary].ExcludedTypes) != 2 {
		t.Errorf("Expected cycling to have 2 excluded types, got %d", len(cycling.Mappings[stravaSportTypeVocabulary].ExcludedTypes))
	}

	// Verify specific excluded types
	excludedMap := make(map[string]bool)
	for _, et := range cycling.Mappings[stravaSportTypeVocabulary].ExcludedTypes {
		excludedMap[et] = true
	}

	if !excludedMap["EBikeRide"] {
		t.Error("Expected EBikeRide to be in cycling excluded_types")
	}
	if !excludedMap["EMountainBikeRide"] {
		t.Error("Expected EMountainBikeRide to be in cycling excluded_types")
	}

	// Running should have no excluded types
	running, ok := config.data.SportCategories["running"]
	if !ok {
		t.Fatal("Expected running category to exist")
	}

	if len(running.Mappings[stravaSportTypeVocabulary].ExcludedTypes) != 0 {
		t.Errorf("Expected running to have 0 excluded types, got %d", len(running.Mappings[stravaSportTypeVocabulary].ExcludedTypes))
	}
}

func TestUnsupportedVersionFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	configData := SportConfigData{
		Version: "99.0",
		SportCategories: map[string]SportCategory{
			"cycling": {
				SportMetadata: SportMetadata{
					DisplayName:   "Cycling",
					PrimaryMetric: "distance_meters",
					Metrics:       []string{"distance_meters"},
					HasDistance:   true,
					HasElevation:  true,
				},
				Mappings: map[string]SportTypeMapping{
					stravaSportTypeVocabulary: {Types: []string{"Ride"}},
				},
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

	// Missing required field: mappings
	invalidJSON := `{"version": "2.0", "sportCategories": {"cycling": {"displayName": "Cycling"}}}`
	err := os.WriteFile(configPath, []byte(invalidJSON), 0o600)
	if err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err = NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error, got: %v", err)
	}
}

func TestWarnAtFractionOutOfRangeFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	// dangerPace.warnAtFraction must be within [0, 1]; 1.5 is out of range.
	invalidJSON := `{"version":"2.0","sportCategories":{"cycling":{"displayName":"Cycling","mappings":{"strava.sport_type":{"types":["Ride"],"excludedTypes":[]}},"primaryMetric":"distance_meters","metrics":["distance_meters"],"hasDistance":true,"hasElevation":true,"dangerPace":{"valuePerDay":20,"unit":"miles","warnAtFraction":1.5}}}}`
	if err := os.WriteFile(configPath, []byte(invalidJSON), 0o600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	_, err := NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "invalid sport config schema") {
		t.Errorf("Expected schema validation error for out-of-range warnAtFraction, got: %v", err)
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
		// Unmapped sport_type falls into the "other" bucket and triggers a
		// WARNING log (see TestGetCategoryForStravaType_UnknownLogsWarning).
		{"UnknownSport", "other"},
		// Empty string is bucketed to "other" silently (no WARNING log) —
		// guards against a future NULL/empty column landing here.
		{"", "other"},
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

// TestGetCategoryForStravaType_UnknownLogsWarning verifies that the first time
// a sport_type with no mapping is seen, GetCategoryForStravaType emits the
// structured WARNING that the GCP log-based metric (and downstream alert)
// pivots on. The metric filter in terraform/modules/desirelines/monitoring.tf
// keys off the structured "event" field (jsonPayload.event="unknown_sport_type"),
// so that value is asserted as the load-bearing contract; the human-readable
// message is asserted separately but is free to be reworded.
//
// Subsequent calls for the same unmapped type are deduplicated — that
// invariant is exercised below by confirming the buffer doesn't grow.
func TestGetCategoryForStravaType_UnknownLogsWarning(t *testing.T) {
	config, err := NewSportConfig("sport_types.json")
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))

	const unmapped = "HighIntensityYogaCrossfit"

	if got := config.GetCategoryForStravaType(unmapped); got != UnknownSportCategory {
		t.Fatalf("got category %q, want %q", got, UnknownSportCategory)
	}

	out := buf.String()
	// Load-bearing: the log-based metric filters on this structured event field.
	if !strings.Contains(out, `"event":"`+unknownSportLogEvent+`"`) {
		t.Errorf("expected monitored event field %q, got: %s", unknownSportLogEvent, out)
	}
	if !strings.Contains(out, "Unknown Strava sport_type detected") {
		t.Errorf("expected canonical WARNING message, got: %s", out)
	}
	if !strings.Contains(out, `"unmapped_sport_type":"`+unmapped+`"`) {
		t.Errorf("expected unmapped_sport_type attribute, got: %s", out)
	}
	if !strings.Contains(out, `"fallback_category":"`+UnknownSportCategory+`"`) {
		t.Errorf("expected fallback_category attribute, got: %s", out)
	}

	// Dedup: re-calling with the same unmapped type must not emit a second log.
	sizeAfterFirst := buf.Len()
	_ = config.GetCategoryForStravaType(unmapped)
	if buf.Len() != sizeAfterFirst {
		t.Errorf("expected per-process dedup, got additional log output: %s", buf.String()[sizeAfterFirst:])
	}

	// Different unmapped type emits a fresh log.
	_ = config.GetCategoryForStravaType("AnotherUnmappedSport")
	if buf.Len() == sizeAfterFirst {
		t.Error("expected a fresh log for a different unmapped type, got none")
	}
}

func TestEmptyStravaTypesFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	configData := SportConfigData{
		Version: "2.0",
		SportCategories: map[string]SportCategory{
			"cycling": {
				SportMetadata: SportMetadata{
					DisplayName:   "Cycling",
					PrimaryMetric: "distance_meters",
					Metrics:       []string{"distance_meters"},
					HasDistance:   true,
					HasElevation:  true,
				},
				Mappings: map[string]SportTypeMapping{
					stravaSportTypeVocabulary: {Types: []string{}},
				},
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

func TestDuplicateStravaTypeAcrossCategoriesFails(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test.json")

	// "Ride" appears under two categories — must fail fast at load. Without
	// the guard the reverseMap winner is map-iteration-order-random per process.
	configData := SportConfigData{
		Version: "2.0",
		SportCategories: map[string]SportCategory{
			"cycling": {
				SportMetadata: SportMetadata{
					DisplayName:   "Cycling",
					PrimaryMetric: "distance_meters",
					Metrics:       []string{"distance_meters"},
					HasDistance:   true,
					HasElevation:  true,
				},
				Mappings: map[string]SportTypeMapping{
					stravaSportTypeVocabulary: {Types: []string{"Ride"}},
				},
			},
			"ebike": {
				SportMetadata: SportMetadata{
					DisplayName:   "E-Bike",
					PrimaryMetric: "distance_meters",
					Metrics:       []string{"distance_meters"},
					HasDistance:   true,
					HasElevation:  true,
				},
				Mappings: map[string]SportTypeMapping{
					stravaSportTypeVocabulary: {Types: []string{"Ride"}},
				},
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

	// Map iteration order is randomized, so which category is "existing" vs
	// the duplicate is nondeterministic — assert only on the stable parts.
	_, err = NewSportConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "maps to multiple categories") ||
		!strings.Contains(err.Error(), `"Ride"`) {
		t.Errorf("Expected duplicate-sport_type error naming \"Ride\", got: %v", err)
	}
}

func TestRealConfigLoadsWithoutDuplicates(t *testing.T) {
	// The committed sport_types.json must satisfy the uniqueness invariant.
	if _, err := NewSportConfig("sport_types.json"); err != nil {
		t.Fatalf("real sport_types.json failed to load: %v", err)
	}
}
