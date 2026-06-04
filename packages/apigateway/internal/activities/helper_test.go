package activities

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
)

func TestRespondProtobuf_MarshalCamelCase(t *testing.T) {
	h := newTestHandler(t)

	// SportMetrics has fields like distance_meters which map to DistanceMeters in Go
	// proto definition: optional double distance_meters = 1;
	// generated Go: DistanceMeters *float64 `json:"distance_meters,omitempty"`
	// protojson (UseProtoNames: false) -> "distanceMeters"

	dist := 100.0
	msg := &generated.DailyActivity{
		DistanceMeters: &dist,
		Activities:     5,
	}

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	h.respondProtobuf(w, req, msg)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", contentType)
	}

	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	// Verify camelCase keys (default protojson behavior) are used
	if _, ok := response["distanceMeters"]; !ok {
		t.Error("expected 'distanceMeters' key in JSON response")
	}
	if _, ok := response["distance_meters"]; ok {
		t.Error("did not expect 'distance_meters' (snake_case) key in JSON response")
	}

	if val, ok := response["activities"]; !ok {
		t.Error("expected 'activities' key in JSON response")
	} else if v, okType := val.(float64); !okType || v != 5 {
		t.Errorf("expected activities=5, got %v", val)
	}
}

func TestRespondProtobuf_OmitOptional(t *testing.T) {
	h := newTestHandler(t)

	// DailyActivity with only Activities set
	// distance_meters is optional in proto, so nil pointer in Go should be omitted in JSON
	msg := &generated.DailyActivity{
		Activities: 10,
	}

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	h.respondProtobuf(w, req, msg)

	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if _, ok := response["distanceMeters"]; ok {
		t.Error("expected 'distanceMeters' to be omitted when nil")
	}
	if val, ok := response["activities"]; !ok {
		t.Error("expected 'activities' key in JSON response")
	} else if v, okType := val.(float64); !okType || v != 10 {
		t.Errorf("expected activities=10, got %v", val)
	}
}

func TestRespondProtobuf_Nil(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	h.respondProtobuf(w, req, nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// nil interface{} -> null in JSON
	if w.Body.String() != "null\n" && w.Body.String() != "null" {
		t.Errorf("expected 'null' response body, got %q", w.Body.String())
	}
}

// --- multi-sport merge tests (audit 2026-06-02-apigateway-shared M1/L1/L3) ---

func ptrInt32(v int32) *int32 { return &v }

func cumEntry(date string, distance float64, activities *int32) *generated.CumulativeMetricsEntry {
	d := distance
	return &generated.CumulativeMetricsEntry{Date: date, Distance: &d, Activities: activities}
}

func TestMergeMultiSportMetrics_MergesAlignedTimeseries(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride") // == GetCategoryForStravaType("VirtualRide")

	out := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, ptrInt32(2)),
			cumEntry("2025-01-02", 3, ptrInt32(1)),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, ptrInt32(5)),
			cumEntry("2025-01-02", 30, ptrInt32(4)),
		}},
	})

	merged, ok := out[cat]
	if !ok {
		t.Fatalf("expected merged category %q in result", cat)
	}
	if len(merged.Timeseries) != 2 {
		t.Fatalf("timeseries len = %d, want 2", len(merged.Timeseries))
	}
	if got := *merged.Timeseries[0].Distance; got != 11 {
		t.Errorf("day0 distance = %v, want 11 (1+10)", got)
	}
	if got := *merged.Timeseries[0].Activities; got != 7 {
		t.Errorf("day0 activities = %v, want 7 (2+5)", got)
	}
	if got := *merged.Timeseries[1].Distance; got != 33 {
		t.Errorf("day1 distance = %v, want 33 (3+30)", got)
	}
}

// L1: a count present on only one side must survive the merge (the old
// both-non-nil guard silently dropped it).
func TestMergeInt32PtrField_NilSafe(t *testing.T) {
	var a *int32
	five := int32(5)
	mergeInt32PtrField(&a, &five) // nil + 5 → 5
	if a == nil || *a != 5 {
		t.Fatalf("nil + 5 = %v, want 5", a)
	}
	mergeInt32PtrField(&a, nil) // 5 + nil → 5
	if *a != 5 {
		t.Errorf("5 + nil = %d, want 5", *a)
	}
	four := int32(4)
	mergeInt32PtrField(&a, &four) // 5 + 4 → 9
	if *a != 9 {
		t.Errorf("5 + 4 = %d, want 9", *a)
	}
}

// M1: a length mismatch must bail (leave an original untouched), never merge
// by index and corrupt totals. day0 distance stays 1 or 10, never a merged 11.
func TestMergeMultiSportMetrics_LengthMismatchBails(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride")

	out := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, nil), cumEntry("2025-01-02", 2, nil),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, nil),
		}},
	})

	if got := *out[cat].Timeseries[0].Distance; got != 1 && got != 10 {
		t.Errorf("day0 distance = %v; length mismatch should have bailed, not merged", got)
	}
}

// M1: same length but a divergent date must also bail.
func TestMergeMultiSportMetrics_DateMismatchBails(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride")

	out := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, nil), cumEntry("2025-01-02", 2, nil),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, nil), cumEntry("2025-09-09", 20, nil),
		}},
	})

	if got := *out[cat].Timeseries[0].Distance; got != 1 && got != 10 {
		t.Errorf("day0 distance = %v; date misalignment should have bailed, not merged", got)
	}
}

// L3: activity ids merged across sport types must be de-duplicated.
func TestMergeMultiSportDailySummary_DedupsActivityIds(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride")

	out := h.mergeMultiSportDailySummary(map[string]*generated.DailySummary{
		"Ride": {Daily: map[string]*generated.DailyActivity{
			"2025-01-01": {ActivityIds: []int64{1, 2}},
		}},
		"VirtualRide": {Daily: map[string]*generated.DailyActivity{
			"2025-01-01": {ActivityIds: []int64{2, 3}},
		}},
	})

	got := out[cat].Daily["2025-01-01"].ActivityIds
	counts := map[int64]int{}
	for _, id := range got {
		counts[id]++
	}
	if len(counts) != 3 {
		t.Errorf("ActivityIds = %v, want 3 unique (1,2,3)", got)
	}
	for id, c := range counts {
		if c != 1 {
			t.Errorf("activity id %d appears %d times, want 1 (deduped)", id, c)
		}
	}
}
