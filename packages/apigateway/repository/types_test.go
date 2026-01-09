package repository

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestActivityListResponse_EmptySerialization(t *testing.T) {
	// Test that empty slice serializes to [] not null
	resp := ActivityListResponse{
		Activities: make([]ActivitySummary, 0),
		HasMore:    false,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	want := `{"activities":[],"has_more":false}`
	if string(data) != want {
		t.Errorf("got %s, want %s", string(data), want)
	}
}

func TestActivity_OptionalFields(t *testing.T) {
	// Test omitempty behavior
	val := 100.0
	activity := Activity{
		ID:              1,
		Name:            "Run",
		ElevationMeters: &val, // Set
		AverageSpeedMps: nil,  // Unset
	}

	data, err := json.Marshal(activity)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Should contain elevation_meters
	if !strings.Contains(string(data), `"elevation_meters":100`) {
		t.Error("expected elevation_meters in output")
	}

	// Should NOT contain average_speed_mps
	if strings.Contains(string(data), "average_speed_mps") {
		t.Error("expected average_speed_mps to be omitted")
	}
}
