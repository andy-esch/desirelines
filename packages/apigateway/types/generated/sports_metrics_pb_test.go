package generated

import (
	"encoding/json"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
)

const (
	testDate20240115 = "2024-01-15"
	testDate20240116 = "2024-01-16"
)

func TestSportMetrics_CyclingWithDistanceAndElevation(t *testing.T) {
	// Create metrics for cycling with cumulative metrics
	metrics := &SportMetrics{
		Timeseries: []*CumulativeMetricsEntry{
			{
				Date:       testDate20240115,
				Distance:   ptrFloat64(10000.0), // 10km cumulative
				Elevation:  ptrFloat64(200.0),
				Time:       ptrFloat64(60.0), // 1 hour
				Activities: ptrInt32(1),
			},
			{
				Date:       testDate20240116,
				Distance:   ptrFloat64(25000.0), // 25km cumulative (15km added)
				Elevation:  ptrFloat64(450.0),   // 450m cumulative (250m added)
				Time:       ptrFloat64(180.5),   // 180.5 minutes cumulative
				Activities: ptrInt32(2),
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
	timeseries, ok := data["timeseries"].([]any)
	if !ok {
		t.Fatalf("Expected data[\"timeseries\"] to be []any, got %T", data["timeseries"])
	}
	if len(timeseries) != 2 {
		t.Fatalf("Expected 2 timeseries entries, got %d", len(timeseries))
	}

	entry1, ok := timeseries[0].(map[string]any)
	if !ok {
		t.Fatalf("Expected timeseries[0] to be map[string]any, got %T", timeseries[0])
	}
	if entry1["date"] != testDate20240115 {
		t.Errorf("Expected date to be %q, got %v", testDate20240115, entry1["date"])
	}
	distance1, ok := entry1["distance"].(float64)
	if !ok {
		t.Fatalf("Expected entry1[\"distance\"] to be float64, got %T", entry1["distance"])
	}
	if distance1 != 10000.0 {
		t.Errorf("Expected distance to be 10000.0, got %v", entry1["distance"])
	}
	elevation1, ok := entry1["elevation"].(float64)
	if !ok {
		t.Fatalf("Expected entry1[\"elevation\"] to be float64, got %T", entry1["elevation"])
	}
	if elevation1 != 200.0 {
		t.Errorf("Expected elevation to be 200.0, got %v", entry1["elevation"])
	}

	entry2, ok := timeseries[1].(map[string]any)
	if !ok {
		t.Fatalf("Expected timeseries[1] to be map[string]any, got %T", timeseries[1])
	}
	distance2, ok := entry2["distance"].(float64)
	if !ok {
		t.Fatalf("Expected entry2[\"distance\"] to be float64, got %T", entry2["distance"])
	}
	if distance2 != 25000.0 {
		t.Errorf("Expected distance to be 25000.0, got %v", entry2["distance"])
	}
}

func TestSportMetrics_YogaWithoutDistance(t *testing.T) {
	// Create metrics for yoga (no distance or elevation) with cumulative metrics
	metrics := &SportMetrics{
		Timeseries: []*CumulativeMetricsEntry{
			{
				Date:       testDate20240115,
				Time:       ptrFloat64(60.0),
				Activities: ptrInt32(1),
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
	timeseries, ok := data["timeseries"].([]any)
	if !ok {
		t.Fatalf("Expected data[\"timeseries\"] to be []any, got %T", data["timeseries"])
	}

	entry, ok := timeseries[0].(map[string]any)
	if !ok {
		t.Fatalf("Expected timeseries[0] to be map[string]any, got %T", timeseries[0])
	}
	if _, exists := entry["distance"]; exists {
		t.Error("Expected distance to be omitted, but it was present")
	}
	if _, exists := entry["elevation"]; exists {
		t.Error("Expected elevation to be omitted, but it was present")
	}
	timeMinutes, ok := entry["time"].(float64)
	if !ok {
		t.Fatalf("Expected entry[\"time\"] to be float64, got %T", entry["time"])
	}
	if timeMinutes != 60.0 {
		t.Errorf("Expected time to be 60.0, got %v", entry["time"])
	}
}

func TestSportMetrics_TimeseriesData(t *testing.T) {
	// Create metrics with cumulative metrics timeseries
	metrics := &SportMetrics{
		Timeseries: []*CumulativeMetricsEntry{
			{
				Date:       testDate20240115,
				Distance:   ptrFloat64(10000.0),
				Time:       ptrFloat64(60.0),
				Activities: ptrInt32(1),
			},
			{
				Date:       testDate20240116,
				Distance:   ptrFloat64(15000.0),
				Time:       ptrFloat64(90.0),
				Activities: ptrInt32(2),
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
	timeseries, ok := data["timeseries"].([]any)
	if !ok {
		t.Fatalf("Expected data[\"timeseries\"] to be []any, got %T", data["timeseries"])
	}

	if len(timeseries) != 2 {
		t.Fatalf("Expected 2 timeseries entries, got %d", len(timeseries))
	}

	entry1, ok := timeseries[0].(map[string]any)
	if !ok {
		t.Fatalf("Expected timeseries[0] to be map[string]any, got %T", timeseries[0])
	}
	if entry1["date"] != testDate20240115 {
		t.Errorf("Expected date to be %q, got %v", testDate20240115, entry1["date"])
	}
	entry1Distance, ok := entry1["distance"].(float64)
	if !ok {
		t.Fatalf("Expected entry1[\"distance\"] to be float64, got %T", entry1["distance"])
	}
	if entry1Distance != 10000.0 {
		t.Errorf("Expected distance to be 10000.0, got %v", entry1["distance"])
	}

	entry2, ok := timeseries[1].(map[string]any)
	if !ok {
		t.Fatalf("Expected timeseries[1] to be map[string]any, got %T", timeseries[1])
	}
	if entry2["date"] != testDate20240116 {
		t.Errorf("Expected date to be %q, got %v", testDate20240116, entry2["date"])
	}
	entry2Distance, ok := entry2["distance"].(float64)
	if !ok {
		t.Fatalf("Expected entry2[\"distance\"] to be float64, got %T", entry2["distance"])
	}
	if entry2Distance != 15000.0 {
		t.Errorf("Expected distance to be 15000.0, got %v", entry2["distance"])
	}
}

func TestSportMetrics_Deserialization(t *testing.T) {
	jsonData := `{
		"timeseries": [
			{
				"date": "` + testDate20240115 + `",
				"distance": 5000.0,
				"time": 30.0,
				"activities": 1
			},
			{
				"date": "` + testDate20240116 + `",
				"distance": 10000.0,
				"time": 60.0,
				"elevation": 200.0,
				"activities": 2
			}
		]
	}`

	// Parse JSON into protobuf
	metrics := &SportMetrics{}
	if unmarshalErr := protojson.Unmarshal([]byte(jsonData), metrics); unmarshalErr != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", unmarshalErr)
	}

	// Verify fields
	if len(metrics.Timeseries) != 2 {
		t.Fatalf("Expected 2 timeseries entries, got %d", len(metrics.Timeseries))
	}

	entry1 := metrics.Timeseries[0]
	if entry1.Date != testDate20240115 {
		t.Errorf("Expected date to be %q, got %v", testDate20240115, entry1.Date)
	}
	if *entry1.Distance != 5000.0 {
		t.Errorf("Expected distance to be 5000.0, got %v", *entry1.Distance)
	}
	if *entry1.Time != 30.0 {
		t.Errorf("Expected time to be 30.0, got %v", *entry1.Time)
	}
	if *entry1.Activities != 1 {
		t.Errorf("Expected activities to be 1, got %v", *entry1.Activities)
	}

	entry2 := metrics.Timeseries[1]
	if entry2.Date != testDate20240116 {
		t.Errorf("Expected date to be %q, got %v", testDate20240116, entry2.Date)
	}
	if *entry2.Distance != 10000.0 {
		t.Errorf("Expected distance to be 10000.0, got %v", *entry2.Distance)
	}
	if *entry2.Elevation != 200.0 {
		t.Errorf("Expected elevation to be 200.0, got %v", *entry2.Elevation)
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

// Helper function to create pointer to int32
func ptrInt32(i int32) *int32 {
	return &i
}
