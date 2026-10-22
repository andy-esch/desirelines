package activities

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
)

func TestRespondProtobuf_MarshalCamelCase(t *testing.T) {
	h := newTestHandler(t)

	// The proto field distance_meters must reach the client as "distanceMeters":
	// the marshaler emits protojson JSON names (UseProtoNames: false).
	msg := &generated.DailyActivity{
		DistanceMeters: new(100.0),
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

// protojson rejects invalid UTF-8 in a string field. The client must get the
// standard 500 error envelope, not a partial body.
func TestRespondProtobuf_MarshalFailureWritesInternalError(t *testing.T) {
	h := newTestHandler(t)
	msg := &generated.YearMetadata{Sports: []string{"\xff"}}

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	h.respondProtobuf(w, req, msg)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not a JSON error envelope: %v (body %q)", err, w.Body.String())
	}
	if body["error"] != errMsgInternalServerError {
		t.Errorf("error = %v, want %q", body["error"], errMsgInternalServerError)
	}
}

// --- sport categorization ---

// Types that share a category collapse into it: Sports keeps first-seen order
// without duplicates, and their Totals are summed, keeping a value present on
// only one side.
func TestCategorizeSports_MergesTypesSharingACategory(t *testing.T) {
	h := newTestHandler(t)
	cycling := h.sportConfig.GetCategoryForStravaType("Ride")
	running := h.sportConfig.GetCategoryForStravaType("Run")
	if h.sportConfig.GetCategoryForStravaType("VirtualRide") != cycling || running == cycling {
		t.Fatal("fixture assumes Ride and VirtualRide share a category and Run does not")
	}

	metadata := &generated.YearMetadata{
		Sports: []string{"Ride", "Run", "VirtualRide"},
		Totals: map[string]*generated.SportTotals{
			"Ride":        {DistanceMeters: new(1000.0), TimeMinutes: new(60.0), Activities: 2},
			"VirtualRide": {DistanceMeters: new(500.0), ElevationMeters: new(30.0), Activities: 1},
			"Run":         {DistanceMeters: new(5000.0), Activities: 1},
		},
	}

	h.categorizeSports(metadata)

	if want := []string{cycling, running}; !slices.Equal(metadata.Sports, want) {
		t.Errorf("Sports = %v, want %v", metadata.Sports, want)
	}
	if got := slices.Sorted(maps.Keys(metadata.Totals)); len(got) != 2 {
		t.Fatalf("Totals keys = %v, want only %q and %q", got, cycling, running)
	}
	merged := metadata.Totals[cycling]
	if got := merged.GetDistanceMeters(); got != 1500 {
		t.Errorf("cycling distance = %v, want 1500 (1000+500)", got)
	}
	if got := merged.GetTimeMinutes(); got != 60 {
		t.Errorf("cycling time = %v, want 60 (Ride only)", got)
	}
	if got := merged.GetElevationMeters(); got != 30 {
		t.Errorf("cycling elevation = %v, want 30 (VirtualRide only)", got)
	}
	if merged.Activities != 3 {
		t.Errorf("cycling activities = %d, want 3 (2+1)", merged.Activities)
	}
	if got := metadata.Totals[running].GetDistanceMeters(); got != 5000 {
		t.Errorf("running distance = %v, want 5000", got)
	}
}

// Unrecognized and empty sport types land in the unknown category instead of
// being dropped.
func TestCategorizeSports_UnknownTypesFallBackToOther(t *testing.T) {
	h := newTestHandler(t)
	metadata := &generated.YearMetadata{
		Sports: []string{"NotAStravaSportType", ""},
		Totals: map[string]*generated.SportTotals{
			"NotAStravaSportType": {Activities: 1},
			"":                    {Activities: 2},
		},
	}

	h.categorizeSports(metadata)

	if want := []string{config.UnknownSportCategory}; !slices.Equal(metadata.Sports, want) {
		t.Errorf("Sports = %v, want %v", metadata.Sports, want)
	}
	if got := metadata.Totals[config.UnknownSportCategory].GetActivities(); got != 3 {
		t.Errorf("%s activities = %d, want 3 (1+2)", config.UnknownSportCategory, got)
	}
}

func TestCategorizeSports_LeavesMissingTotalsNil(t *testing.T) {
	h := newTestHandler(t)
	metadata := &generated.YearMetadata{Sports: []string{"Ride"}}

	h.categorizeSports(metadata)

	if metadata.Totals != nil {
		t.Errorf("Totals = %v, want nil", metadata.Totals)
	}
	if want := []string{h.sportConfig.GetCategoryForStravaType("Ride")}; !slices.Equal(metadata.Sports, want) {
		t.Errorf("Sports = %v, want %v", metadata.Sports, want)
	}
}

func TestSoleCategory(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		value, categories, ok := soleCategory(map[string]int{})
		if value != 0 || categories != nil || !ok {
			t.Errorf("soleCategory(empty) = (%v, %v, %v), want (0, nil, true)", value, categories, ok)
		}
	})
	t.Run("one category", func(t *testing.T) {
		value, categories, ok := soleCategory(map[string]int{"cycling": 7})
		if value != 7 || categories != nil || !ok {
			t.Errorf("soleCategory(one) = (%v, %v, %v), want (7, nil, true)", value, categories, ok)
		}
	})
	t.Run("several categories", func(t *testing.T) {
		value, categories, ok := soleCategory(map[string]int{"cycling": 1, "running": 2})
		slices.Sort(categories)
		if value != 0 || ok || !slices.Equal(categories, []string{"cycling", "running"}) {
			t.Errorf("soleCategory(two) = (%v, %v, %v), want (0, [cycling running], false)", value, categories, ok)
		}
	})
}

// --- multi-sport merges ---

func cumEntry(date string, distance float64, activities *int32) *generated.CumulativeMetricsEntry {
	return &generated.CumulativeMetricsEntry{Date: date, Distance: new(distance), Activities: activities}
}

func TestMergeMultiSportMetrics_MergesAlignedTimeseries(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride") // == GetCategoryForStravaType("VirtualRide")

	out, err := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, new(int32(2))),
			cumEntry("2025-01-02", 3, new(int32(1))),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, new(int32(5))),
			cumEntry("2025-01-02", 30, new(int32(4))),
		}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

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

// A value present on only one side must survive the merge.
func TestMergePtrField_NilSafe(t *testing.T) {
	var a *int32
	mergePtrField(&a, new(int32(5))) // nil + 5 → 5
	if a == nil || *a != 5 {
		t.Fatalf("nil + 5 = %v, want 5", a)
	}
	mergePtrField(&a, nil) // 5 + nil → 5
	if *a != 5 {
		t.Errorf("5 + nil = %d, want 5", *a)
	}
	mergePtrField(&a, new(int32(4))) // 5 + 4 → 9
	if *a != 9 {
		t.Errorf("5 + 4 = %d, want 9", *a)
	}
}

// A length mismatch breaks the dense, date-aligned invariant. Rather than
// returning partial totals, the merge must return an error so the handler can
// fail with a 500.
func TestMergeMultiSportMetrics_LengthMismatchErrors(t *testing.T) {
	h := newTestHandler(t)

	out, err := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, nil), cumEntry("2025-01-02", 2, nil),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, nil),
		}},
	})

	if err == nil {
		t.Fatalf("expected error on length mismatch, got nil (out=%v)", out)
	}
	if out != nil {
		t.Errorf("expected nil result on error, got %v", out)
	}
}

// Same length but a divergent date also breaks the invariant and must error.
func TestMergeMultiSportMetrics_DateMismatchErrors(t *testing.T) {
	h := newTestHandler(t)

	out, err := h.mergeMultiSportMetrics(map[string]*generated.SportMetrics{
		"Ride": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 1, nil), cumEntry("2025-01-02", 2, nil),
		}},
		"VirtualRide": {Timeseries: []*generated.CumulativeMetricsEntry{
			cumEntry("2025-01-01", 10, nil), cumEntry("2025-09-09", 20, nil),
		}},
	})

	if err == nil {
		t.Fatalf("expected error on date misalignment, got nil (out=%v)", out)
	}
	if out != nil {
		t.Errorf("expected nil result on error, got %v", out)
	}
}

// Shared days are summed and days present for only one type are kept. Each
// type carries a day the other lacks, so both paths run whichever type the map
// iteration visits first.
func TestMergeMultiSportDailySummary_SumsSharedDaysAndKeepsTheRest(t *testing.T) {
	h := newTestHandler(t)
	cat := h.sportConfig.GetCategoryForStravaType("Ride")

	out := h.mergeMultiSportDailySummary(map[string]*generated.DailySummary{
		"Ride": {Daily: map[string]*generated.DailyActivity{
			"2025-01-01": {DistanceMeters: new(10.0), Activities: 1, ActivityIds: []int64{1}},
			"2025-01-02": {Activities: 1, ActivityIds: []int64{2}},
		}},
		"VirtualRide": {Daily: map[string]*generated.DailyActivity{
			"2025-01-01": {DistanceMeters: new(5.0), TimeMinutes: new(30.0), Activities: 1, ActivityIds: []int64{3}},
			"2025-01-03": {Activities: 1, ActivityIds: []int64{4}},
		}},
	})

	if len(out) != 1 {
		t.Fatalf("categories = %v, want only %q", slices.Sorted(maps.Keys(out)), cat)
	}
	daily := out[cat].Daily
	if got, want := slices.Sorted(maps.Keys(daily)), []string{"2025-01-01", "2025-01-02", "2025-01-03"}; !slices.Equal(got, want) {
		t.Fatalf("days = %v, want %v", got, want)
	}
	shared := daily["2025-01-01"]
	if shared.GetDistanceMeters() != 15 || shared.GetTimeMinutes() != 30 || shared.Activities != 2 {
		t.Errorf("shared day = distance %v, time %v, activities %d; want 15, 30, 2",
			shared.GetDistanceMeters(), shared.GetTimeMinutes(), shared.Activities)
	}
	ids := slices.Sorted(slices.Values(shared.ActivityIds))
	if !slices.Equal(ids, []int64{1, 3}) {
		t.Errorf("shared day ActivityIds = %v, want [1 3]", ids)
	}
}

// Activity ids merged across sport types must be de-duplicated.
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

func TestAppendUniqueInt64(t *testing.T) {
	tests := []struct {
		name           string
		dst, src, want []int64
	}{
		{name: "empty src keeps dst", dst: []int64{1, 2}, src: nil, want: []int64{1, 2}},
		{name: "skips ids already in dst", dst: []int64{1, 2}, src: []int64{2, 3}, want: []int64{1, 2, 3}},
		{name: "dedups within src", dst: nil, src: []int64{4, 4, 5}, want: []int64{4, 5}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := appendUniqueInt64(tt.dst, tt.src); !slices.Equal(got, tt.want) {
				t.Errorf("appendUniqueInt64(%v, %v) = %v, want %v", tt.dst, tt.src, got, tt.want)
			}
		})
	}
}
