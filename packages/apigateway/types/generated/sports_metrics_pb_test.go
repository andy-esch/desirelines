package generated

import (
	"encoding/json"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
)

func TestSportMetrics_CyclingWithDistanceAndElevation(t *testing.T) {
	// Create metrics for cycling (has distance and elevation)
	metrics := &SportMetrics{
		Metadata: &SportMetadata{
			Sport:             "cycling",
			Year:              2024,
			AvailableMetrics:  []string{"distance_meters", "time_minutes", "elevation_meters"},
			PrimaryMetric:     "distance_meters",
		},
		Daily: map[string]*DailyActivity{
			"2024-01-15": {
				DistanceMeters:   ptrFloat64(42195.0), // Marathon distance in meters
				TimeMinutes:      ptrFloat64(120.5),
				ElevationMeters:  ptrFloat64(450.0),
				Activities:       2,
				ActivityIds:      []int64{123456, 123457},
			},
		},
	}

	// Convert to JSON
	jsonBytes, err := protojson.Marshal(metrics)
	if err != nil {
		t.Fatalf("Failed to marshal to JSON: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Verify structure
	metadata := data["metadata"].(map[string]interface{})
	if metadata["sport"] != "cycling" {
		t.Errorf("Expected sport to be 'cycling', got %v", metadata["sport"])
	}
	if metadata["year"].(float64) != 2024 {
		t.Errorf("Expected year to be 2024, got %v", metadata["year"])
	}

	daily := data["daily"].(map[string]interface{})["2024-01-15"].(map[string]interface{})
	if daily["distanceMeters"].(float64) != 42195.0 {
		t.Errorf("Expected distanceMeters to be 42195.0, got %v", daily["distanceMeters"])
	}
	if daily["elevationMeters"].(float64) != 450.0 {
		t.Errorf("Expected elevationMeters to be 450.0, got %v", daily["elevationMeters"])
	}
	if daily["activities"].(float64) != 2 {
		t.Errorf("Expected activities to be 2, got %v", daily["activities"])
	}
}

func TestSportMetrics_YogaWithoutDistance(t *testing.T) {
	// Create metrics for yoga (no distance or elevation)
	metrics := &SportMetrics{
		Metadata: &SportMetadata{
			Sport:            "yoga",
			Year:             2024,
			AvailableMetrics: []string{"time_minutes"},
			PrimaryMetric:    "time_minutes",
		},
		Daily: map[string]*DailyActivity{
			"2024-01-15": {
				TimeMinutes: ptrFloat64(60.0),
				Activities:  1,
				ActivityIds: []int64{123458},
			},
		},
	}

	// Convert to JSON
	jsonBytes, err := protojson.Marshal(metrics)
	if err != nil {
		t.Fatalf("Failed to marshal to JSON: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Verify optional fields are omitted when not set
	daily := data["daily"].(map[string]interface{})["2024-01-15"].(map[string]interface{})
	if _, ok := daily["distanceMeters"]; ok {
		t.Error("Expected distanceMeters to be omitted, but it was present")
	}
	if _, ok := daily["elevationMeters"]; ok {
		t.Error("Expected elevationMeters to be omitted, but it was present")
	}
	if daily["timeMinutes"].(float64) != 60.0 {
		t.Errorf("Expected timeMinutes to be 60.0, got %v", daily["timeMinutes"])
	}
}

func TestSportMetrics_TimeseriesData(t *testing.T) {
	// Create metrics with timeseries
	metrics := &SportMetrics{
		Timeseries: &MetricsTimeseries{
			DistanceMeters: []*MetricTimeseriesEntry{
				{Date: "2024-01-15", Value: 10000.0},
				{Date: "2024-01-16", Value: 15000.0},
			},
		},
	}

	// Convert to JSON
	jsonBytes, err := protojson.Marshal(metrics)
	if err != nil {
		t.Fatalf("Failed to marshal to JSON: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Verify timeseries structure
	timeseries := data["timeseries"].(map[string]interface{})
	distanceMeters := timeseries["distanceMeters"].([]interface{})

	if len(distanceMeters) != 2 {
		t.Fatalf("Expected 2 timeseries entries, got %d", len(distanceMeters))
	}

	entry1 := distanceMeters[0].(map[string]interface{})
	if entry1["date"] != "2024-01-15" {
		t.Errorf("Expected date to be '2024-01-15', got %v", entry1["date"])
	}
	if entry1["value"].(float64) != 10000.0 {
		t.Errorf("Expected value to be 10000.0, got %v", entry1["value"])
	}
}

func TestSportMetrics_Deserialization(t *testing.T) {
	jsonData := `{
		"metadata": {
			"sport": "running",
			"year": 2024,
			"availableMetrics": ["distanceMeters", "timeMinutes"],
			"primaryMetric": "distanceMeters"
		},
		"daily": {
			"2024-01-15": {
				"distanceMeters": 5000.0,
				"timeMinutes": 30.0,
				"activities": 1,
				"activityIds": ["999999"]
			}
		}
	}`

	// Parse JSON into protobuf
	metrics := &SportMetrics{}
	if err := protojson.Unmarshal([]byte(jsonData), metrics); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Verify fields
	if metrics.Metadata.Sport != "running" {
		t.Errorf("Expected sport to be 'running', got %v", metrics.Metadata.Sport)
	}
	if metrics.Metadata.Year != 2024 {
		t.Errorf("Expected year to be 2024, got %v", metrics.Metadata.Year)
	}

	daily := metrics.Daily["2024-01-15"]
	if *daily.DistanceMeters != 5000.0 {
		t.Errorf("Expected distanceMeters to be 5000.0, got %v", *daily.DistanceMeters)
	}
	if *daily.TimeMinutes != 30.0 {
		t.Errorf("Expected timeMinutes to be 30.0, got %v", *daily.TimeMinutes)
	}
	if daily.Activities != 1 {
		t.Errorf("Expected activities to be 1, got %v", daily.Activities)
	}
}

func TestYearMetadata_MultipleSports(t *testing.T) {
	metadata := &YearMetadata{
		Year:                 2024,
		Sports:               []string{"cycling", "running", "yoga"},
		LastUpdated:          "2024-11-01T12:00:00Z",
		AggregationVersion:   "1.0",
		Totals: map[string]*SportTotals{
			"cycling": {
				DistanceMeters:  ptrFloat64(500000.0),
				TimeMinutes:     ptrFloat64(2000.0),
				ElevationMeters: ptrFloat64(15000.0),
				Activities:      50,
			},
			"yoga": {
				TimeMinutes: ptrFloat64(1200.0),
				Activities:  30,
			},
		},
	}

	// Convert to JSON
	jsonBytes, err := protojson.Marshal(metadata)
	if err != nil {
		t.Fatalf("Failed to marshal to JSON: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Verify structure
	if data["year"].(float64) != 2024 {
		t.Errorf("Expected year to be 2024, got %v", data["year"])
	}

	sports := data["sports"].([]interface{})
	if len(sports) != 3 {
		t.Errorf("Expected 3 sports, got %d", len(sports))
	}

	totals := data["totals"].(map[string]interface{})
	cycling := totals["cycling"].(map[string]interface{})
	if cycling["distanceMeters"].(float64) != 500000.0 {
		t.Errorf("Expected cycling distanceMeters to be 500000.0, got %v", cycling["distanceMeters"])
	}

	yoga := totals["yoga"].(map[string]interface{})
	if _, ok := yoga["distanceMeters"]; ok {
		t.Error("Expected yoga distanceMeters to be omitted, but it was present")
	}
	if yoga["timeMinutes"].(float64) != 1200.0 {
		t.Errorf("Expected yoga timeMinutes to be 1200.0, got %v", yoga["timeMinutes"])
	}
}

func TestDailyActivity_PartialMetrics(t *testing.T) {
	daily := &DailyActivity{
		DistanceMeters: ptrFloat64(1000.0),
		Activities:     1,
	}

	jsonBytes, err := protojson.Marshal(daily)
	if err != nil {
		t.Fatalf("Failed to marshal to JSON: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	// Only set fields should appear
	if data["distanceMeters"].(float64) != 1000.0 {
		t.Errorf("Expected distanceMeters to be 1000.0, got %v", data["distanceMeters"])
	}
	if _, ok := data["timeMinutes"]; ok {
		t.Error("Expected timeMinutes to be omitted, but it was present")
	}
	if _, ok := data["elevationMeters"]; ok {
		t.Error("Expected elevationMeters to be omitted, but it was present")
	}
}

// Helper function to create pointer to float64
func ptrFloat64(f float64) *float64 {
	return &f
}
