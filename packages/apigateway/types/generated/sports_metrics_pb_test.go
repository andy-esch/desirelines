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
			Sport:            "cycling",
			Year:             2024,
			AvailableMetrics: []string{"distance_meters", "time_minutes", "elevation_meters"},
			PrimaryMetric:    "distance_meters",
		},
		Daily: map[string]*DailyActivity{
			"2024-01-15": {
				DistanceMeters:  ptrFloat64(42195.0), // Marathon distance in meters
				TimeMinutes:     ptrFloat64(120.5),
				ElevationMeters: ptrFloat64(450.0),
				Activities:      2,
				ActivityIds:     []int64{123456, 123457},
			},
		},
	}

	// Convert to JSON
	jsonBytes, marshalErr := protojson.Marshal(metrics)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal to JSON: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Verify structure
	metadata, ok := data["metadata"].(map[string]any)
	if !ok {
		t.Fatal("metadata is not a map[string]any")
	}
	if metadata["sport"] != "cycling" {
		t.Errorf("Expected sport to be 'cycling', got %v", metadata["sport"])
	}
	year, ok := metadata["year"].(float64)
	if !ok {
		t.Fatal("year is not a float64")
	}
	if year != 2024 {
		t.Errorf("Expected year to be 2024, got %v", metadata["year"])
	}

	daily, ok := data["daily"].(map[string]any)["2024-01-15"].(map[string]any)
	if !ok {
		t.Fatal("metadata is not a map[string]any")
	}
	distanceMeters, ok := daily["distanceMeters"].(float64)
	if !ok {
		t.Fatalf("Expected daily[\"distanceMeters\"] to be float64, got %T", daily["distanceMeters"])
	}
	if distanceMeters != 42195.0 {
		t.Errorf("Expected distanceMeters to be 42195.0, got %v", daily["distanceMeters"])
	}
	elevationMeters, ok := daily["elevationMeters"].(float64)
	if !ok {
		t.Fatalf("Expected daily[\"elevationMeters\"] to be float64, got %T", daily["elevationMeters"])
	}
	if elevationMeters != 450.0 {
		t.Errorf("Expected elevationMeters to be 450.0, got %v", daily["elevationMeters"])
	}
	activities, ok := daily["activities"].(float64)
	if !ok {
		t.Fatalf("Expected activities to be float64, got %T", activities)
	}
	if activities != 2 {
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
	jsonBytes, marshalErr := protojson.Marshal(metrics)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal to JSON: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Verify optional fields are omitted when not set
	// First level: get "daily"
	dailyData, ok := data["daily"].(map[string]any)
	if !ok {
		t.Fatalf("data[\"daily\"] is %T, want map[string]any", data["daily"])
	}

	// Second level: get "2024-01-15"
	daily, ok := dailyData["2024-01-15"].(map[string]any)
	if !ok {
		t.Fatalf("data[\"daily\"][\"2024-01-15\"] is %T, want map[string]any", dailyData["2024-01-15"])
	}
	if _, exists := daily["distanceMeters"]; exists {
		t.Error("Expected distanceMeters to be omitted, but it was present")
	}
	if _, exists := daily["elevationMeters"]; exists {
		t.Error("Expected elevationMeters to be omitted, but it was present")
	}
	timeMinutes, ok := daily["timeMinutes"].(float64)
	if !ok {
		t.Fatalf("Expected daily[\"timeMinutes\"] to be float64, got %T", daily["timeMinutes"])
	}
	if timeMinutes != 60.0 {
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
	jsonBytes, marshalErr := protojson.Marshal(metrics)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal to JSON: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Verify timeseries structure
	timeseries, ok := data["timeseries"].(map[string]any)
	if !ok {
		t.Fatalf("Expected data[\"timeseries\"] to be map[string]any, got %T", data["timeseries"])
	}
	distanceMeters, ok := timeseries["distanceMeters"].([]any)
	if !ok {
		t.Fatalf("Expected timeseries[\"distanceMeters\"] to be []any, got %T", timeseries["distanceMeters"])
	}

	if len(distanceMeters) != 2 {
		t.Fatalf("Expected 2 timeseries entries, got %d", len(distanceMeters))
	}

	entry1, ok := distanceMeters[0].(map[string]any)
	if !ok {
		t.Fatalf("Expected distanceMeters[0] to be map[string]any, got %T", distanceMeters[0])
	}
	if entry1["date"] != "2024-01-15" {
		t.Errorf("Expected date to be '2024-01-15', got %v", entry1["date"])
	}
	entry1Value, ok := entry1["value"].(float64)
	if !ok {
		t.Fatalf("Expected entry1[\"value\"] to be float64, got %T", entry1["value"])
	}
	if entry1Value != 10000.0 {
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
	if unmarshalErr := protojson.Unmarshal([]byte(jsonData), metrics); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
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
		Year:               2024,
		Sports:             []string{"cycling", "running", "yoga"},
		LastUpdated:        "2024-11-01T12:00:00Z",
		AggregationVersion: "1.0",
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
	jsonBytes, marshalErr := protojson.Marshal(metadata)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal to JSON: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Verify structure
	year, ok := data["year"].(float64)
	if !ok {
		t.Fatalf("Expected data[\"year\"] to be float64, got %T", data["year"])
	}
	if year != 2024 {
		t.Errorf("Expected year to be 2024, got %v", data["year"])
	}

	sports, ok := data["sports"].([]any)
	if !ok {
		t.Fatalf("Expected data[\"sports\"] to be []any, got %T", data["sports"])
	}
	if len(sports) != 3 {
		t.Errorf("Expected 3 sports, got %d", len(sports))
	}

	totals, ok := data["totals"].(map[string]any)
	if !ok {
		t.Fatalf("Expected data[\"total\"] to be map[string]any, got %T", data["total"])
	}
	cycling, ok := totals["cycling"].(map[string]any)
	if !ok {
		t.Fatal("cycling is not map[string]any")
	}
	distanceMeters, ok := cycling["distanceMeters"].(float64)
	if !ok {
		t.Fatal("cycling['distanceMeters'] cannot be cast as float64")
	}
	if distanceMeters != 500000.0 {
		t.Errorf("Expected cycling distanceMeters to be 500000.0, got %v", cycling["distanceMeters"])
	}

	yoga, ok := totals["yoga"].(map[string]any)
	if !ok {
		t.Fatal("yoga is not map[string]any")
	}
	if _, exists := yoga["distanceMeters"]; exists {
		t.Error("Expected yoga distanceMeters to be omitted, but it was present")
	}
	timeMinutes, ok := yoga["timeMinutes"].(float64)
	if !ok {
		t.Fatal("timeMinutes is not float64")
	}
	if timeMinutes != 1200.0 {
		t.Errorf("Expected yoga timeMinutes to be 1200.0, got %v", yoga["timeMinutes"])
	}
}

func TestDailyActivity_PartialMetrics(t *testing.T) {
	daily := &DailyActivity{
		DistanceMeters: ptrFloat64(1000.0),
		Activities:     1,
	}

	jsonBytes, marshalErr := protojson.Marshal(daily)
	if marshalErr != nil {
		t.Fatalf("Failed to marshal to JSON: %v", marshalErr)
	}

	var data map[string]any
	if unmarshalErr := json.Unmarshal(jsonBytes, &data); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Only set fields should appear
	distanceMeters, ok := data["distanceMeters"].(float64)
	if !ok {
		t.Fatal("distanceMeters is not float64")
	}
	if distanceMeters != 1000.0 {
		t.Errorf("Expected distanceMeters to be 1000.0, got %v", data["distanceMeters"])
	}
	if _, exists := data["timeMinutes"]; exists {
		t.Error("Expected timeMinutes to be omitted, but it was present")
	}
	if _, exists := data["elevationMeters"]; exists {
		t.Error("Expected elevationMeters to be omitted, but it was present")
	}
}

// Helper function to create pointer to float64
func ptrFloat64(f float64) *float64 {
	return &f
}
