package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPublicConfigExclusionsAreAlwaysArrays(t *testing.T) {
	for _, tc := range []struct{ name, field, want string }{
		{"omitted", "", `[]`},
		{"empty", `,"excludedTypes":[]`, `[]`},
		{"populated", `,"excludedTypes":["EBikeRide"]`, `["EBikeRide"]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			category := projectTestCategory(t, "", tc.field)
			if got := string(category["excludedTypes"]); got != tc.want {
				t.Fatalf("excludedTypes = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestPublicConfigPreservesOptionalMetadata(t *testing.T) {
	for _, tc := range []struct{ name, fields string }{
		{"omitted", `{}`},
		{"empty goal defaults", `{"goalDefaults":{}}`},
		{"omitted intervals", `{"goalDefaults":{"increment":10}}`},
		{"empty intervals", `{"goalDefaults":{"chartIntervals":[]}}`},
		{"zero values and fractional intervals", `{"dangerPace":{"valuePerDay":20,"unit":"miles","warnAtFraction":0},"goalDefaults":{"increment":0,"rounding":0,"defaultValue":0,"chartIntervals":[{"max":0,"interval":0.25},{"interval":0.5}]}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var want map[string]json.RawMessage
			if err := json.Unmarshal([]byte(tc.fields), &want); err != nil {
				t.Fatal(err)
			}
			fields := ""
			if len(want) != 0 {
				fields = "," + tc.fields[1:len(tc.fields)-1]
			}
			category := projectTestCategory(t, fields, "")
			for _, key := range []string{"dangerPace", "goalDefaults"} {
				gotJSON, gotPresent := category[key]
				wantJSON, wantPresent := want[key]
				if gotPresent != wantPresent {
					t.Fatalf("%s presence = %t, want %t", key, gotPresent, wantPresent)
				}
				if !wantPresent {
					continue
				}
				var gotValue, wantValue any
				if err := json.Unmarshal(gotJSON, &gotValue); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(wantJSON, &wantValue); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(gotValue, wantValue) {
					t.Errorf("%s = %s, want %s", key, gotJSON, wantJSON)
				}
			}
		})
	}
}

// Project an accepted registry through the real loader, preserving field presence
// in the result so omitted values cannot compare equal to empty arrays or zeros.
func projectTestCategory(t *testing.T, metadataFields, mappingFields string) map[string]json.RawMessage {
	t.Helper()
	path := filepath.Join(t.TempDir(), "registry.json")
	data := `{"version":"2.0","sportCategories":{"cycling":{"displayName":"Cycling","primaryMetric":"distance_meters","metrics":["distance_meters"],"hasDistance":true,"hasElevation":true` + metadataFields + `,"mappings":{"strava.sport_type":{"types":["Ride"]` + mappingFields + `}}}}}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := NewSportConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		SportCategories map[string]map[string]json.RawMessage `json:"sportCategories"`
	}
	if err = json.Unmarshal(c.APIJSON(), &response); err != nil {
		t.Fatal(err)
	}
	return response.SportCategories["cycling"]
}
