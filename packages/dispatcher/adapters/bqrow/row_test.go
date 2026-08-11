package bqrow

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// bqSchemaPath is the BigQuery table schema the destination table is built
// from (see terraform/modules/desirelines/bigquery_subscription.tf). The
// subscription matches message fields against it, so it is the contract these
// tests check the mapping against.
const bqSchemaPath = "../../../../schemas/bigquery/activities_full.json"

const testSeq = "0000000068ABCDEF/0000000000000001"

// rawActivity is a trimmed but representative Strava detailed-activity
// payload: every top-level REQUIRED column of the BigQuery schema, plus a
// nested record (map, athlete, photos), a repeated scalar (start_latlng), a
// repeated record (splits_metric), and fields the table has no column for
// (resource_state, location_city) that the subscription drops.
const rawActivity = `{
  "resource_state": 3,
  "id": 12345678987654321,
  "athlete": {"id": 134815, "resource_state": 1},
  "name": "Happy Friday",
  "distance": 24931.4,
  "moving_time": 4500,
  "elapsed_time": 4500,
  "total_elevation_gain": 0,
  "type": "Ride",
  "sport_type": "MountainBikeRide",
  "workout_type": 10,
  "start_date": "2018-02-16T14:52:54Z",
  "start_date_local": "2018-02-16T06:52:54Z",
  "timezone": "(GMT-08:00) America/Los_Angeles",
  "start_latlng": [37.83, -122.26],
  "end_latlng": [37.83, -122.26],
  "location_city": "Oakland",
  "achievement_count": 0,
  "kudos_count": 3,
  "comment_count": 1,
  "athlete_count": 1,
  "photo_count": 0,
  "total_photo_count": 1,
  "map": {
    "id": "a12345678987654321",
    "polyline": "kwriFrflkVvBHi@?j@?",
    "summary_polyline": "kwriFrflkV",
    "resource_state": 3
  },
  "trainer": false,
  "commute": false,
  "manual": false,
  "private": false,
  "flagged": false,
  "has_kudoed": false,
  "has_heartrate": true,
  "pr_count": 0,
  "average_speed": 5.54,
  "max_speed": 11.0,
  "splits_metric": [
    {"distance": 1001.5, "elapsed_time": 141, "moving_time": 141, "split": 1, "average_speed": 7.1, "pace_zone": 0},
    {"distance": 1000.2, "elapsed_time": 137, "moving_time": 137, "split": 2, "average_speed": 7.3, "pace_zone": 0}
  ],
  "photos": {
    "primary": {
      "id": null,
      "source": 1,
      "unique_id": "d4e4e0d6-a9c2-4d0e-8f9e-1f7f3a4b5c6d",
      "urls": {"100": "https://example.test/100.jpg", "600": "https://example.test/600.jpg"}
    },
    "count": 1
  }
}`

// decodeRow parses a message body with UseNumber so numeric literals can be
// asserted exactly as they appear on the wire.
func decodeRow(t *testing.T, body []byte) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	var row map[string]any
	if err := decoder.Decode(&row); err != nil {
		t.Fatalf("decode message body: %v", err)
	}
	return row
}

func mustUpsert(t *testing.T, raw string) map[string]any {
	t.Helper()
	body, err := Upsert([]byte(raw), testSeq)
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	return decodeRow(t, body)
}

func TestUpsert_SetsCDCFields(t *testing.T) {
	row := mustUpsert(t, rawActivity)

	if got := row["_CHANGE_TYPE"]; got != ChangeTypeUpsert {
		t.Errorf("_CHANGE_TYPE = %v, want %q", got, ChangeTypeUpsert)
	}
	if got := row["_CHANGE_SEQUENCE_NUMBER"]; got != testSeq {
		t.Errorf("_CHANGE_SEQUENCE_NUMBER = %v, want %q", got, testSeq)
	}
}

// The CDC key must survive the round trip exactly. A float64 decode would
// re-encode a large Strava ID as 1.2345678987654322e+16, which BigQuery
// rejects for an INTEGER column — and a silently truncated ID would key the
// upsert to the wrong row.
func TestUpsert_PreservesLargeIntegerID(t *testing.T) {
	row := mustUpsert(t, rawActivity)

	id, ok := row["id"].(json.Number)
	if !ok {
		t.Fatalf("id = %#v, want json.Number", row["id"])
	}
	if id.String() != "12345678987654321" {
		t.Errorf("id = %s, want 12345678987654321 (unchanged)", id.String())
	}
}

func TestUpsert_PreservesNestedAndRepeatedFields(t *testing.T) {
	row := mustUpsert(t, rawActivity)

	activityMap, ok := row["map"].(map[string]any)
	if !ok {
		t.Fatalf("map = %#v, want an object", row["map"])
	}
	if got := activityMap["polyline"]; got != "kwriFrflkVvBHi@?j@?" {
		t.Errorf("map.polyline = %v, want the full polyline", got)
	}
	if got := activityMap["summary_polyline"]; got != "kwriFrflkV" {
		t.Errorf("map.summary_polyline = %v, want kwriFrflkV", got)
	}

	athlete, ok := row["athlete"].(map[string]any)
	if !ok {
		t.Fatalf("athlete = %#v, want an object", row["athlete"])
	}
	if got, isNum := athlete["id"].(json.Number); !isNum || got.String() != "134815" {
		t.Errorf("athlete.id = %v, want 134815", athlete["id"])
	}

	latlng, ok := row["start_latlng"].([]any)
	if !ok || len(latlng) != 2 {
		t.Fatalf("start_latlng = %#v, want a 2-element array", row["start_latlng"])
	}

	splits, ok := row["splits_metric"].([]any)
	if !ok || len(splits) != 2 {
		t.Fatalf("splits_metric = %#v, want a 2-element array", row["splits_metric"])
	}
	firstSplit, ok := splits[0].(map[string]any)
	if !ok {
		t.Fatalf("splits_metric[0] = %#v, want an object", splits[0])
	}
	if got, isNum := firstSplit["split"].(json.Number); !isNum || got.String() != "1" {
		t.Errorf("splits_metric[0].split = %v, want 1", firstSplit["split"])
	}
}

// workout_type is the one scalar whose Strava type (number) disagrees with its
// BigQuery column type (STRING).
func TestUpsert_NormalizesWorkoutType(t *testing.T) {
	tests := []struct {
		name  string
		raw   string
		want  any
		unset bool
	}{
		{
			name: "number becomes string",
			raw:  `{"id": 1, "workout_type": 10}`,
			want: "10",
		},
		{
			name: "null stays null",
			raw:  `{"id": 1, "workout_type": null}`,
			want: nil,
		},
		{
			name:  "absent stays absent",
			raw:   `{"id": 1}`,
			unset: true,
		},
		{
			name: "string is left alone",
			raw:  `{"id": 1, "workout_type": "10"}`,
			want: "10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			row := mustUpsert(t, tt.raw)
			got, present := row["workout_type"]
			if tt.unset {
				if present {
					t.Errorf("workout_type = %v, want absent", got)
				}
				return
			}
			if got != tt.want {
				t.Errorf("workout_type = %#v, want %#v", got, tt.want)
			}
		})
	}
}

// A primary photo with no usable urls keeps its record and omits `urls`.
// The column is NULLABLE on activities_live, so preserving the record costs
// nothing and retains id/media_type/source/unique_id, which the previous
// drop-the-whole-record behavior discarded (audit 2026-08-05-dispatcher L1).
// "already-null primary" is the one case that still yields no record — there
// was nothing to preserve.
func TestUpsert_PhotoPrimaryURLs(t *testing.T) {
	tests := []struct {
		name        string
		raw         string
		wantPrimary bool // is photos.primary still a record?
		wantURLs    bool // does that record carry a urls value?
	}{
		{
			name:        "urls object becomes JSON text",
			raw:         `{"id": 1, "photos": {"count": 1, "primary": {"unique_id": "u", "urls": {"100": "https://example.test/a.jpg"}}}}`,
			wantPrimary: true,
			wantURLs:    true,
		},
		{
			name:        "empty string keeps the record and omits urls",
			raw:         `{"id": 1, "photos": {"count": 0, "primary": {"unique_id": "u", "urls": ""}}}`,
			wantPrimary: true,
		},
		{
			name:        "empty object keeps the record and omits urls",
			raw:         `{"id": 1, "photos": {"count": 0, "primary": {"unique_id": "u", "urls": {}}}}`,
			wantPrimary: true,
		},
		{
			name:        "null urls keeps the record and omits urls",
			raw:         `{"id": 1, "photos": {"count": 0, "primary": {"unique_id": "u", "urls": null}}}`,
			wantPrimary: true,
		},
		{
			name:        "missing urls keeps the record and omits urls",
			raw:         `{"id": 1, "photos": {"count": 0, "primary": {"unique_id": "u"}}}`,
			wantPrimary: true,
		},
		{
			// Nothing to preserve — this is the one case that still yields no record.
			name:        "already-null primary is left alone",
			raw:         `{"id": 1, "photos": {"count": 0, "primary": null}}`,
			wantPrimary: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			row := mustUpsert(t, tt.raw)
			photos, ok := row["photos"].(map[string]any)
			if !ok {
				t.Fatalf("photos = %#v, want an object", row["photos"])
			}
			primary, hasPrimary := photos["primary"].(map[string]any)
			if hasPrimary != tt.wantPrimary {
				t.Fatalf("photos.primary = %#v, want present=%v", photos["primary"], tt.wantPrimary)
			}
			if !tt.wantPrimary {
				if got, present := photos["primary"]; present && got != nil {
					t.Errorf("photos.primary = %#v, want null", got)
				}
				return
			}

			// Whatever else happens, the sibling metadata must survive — losing
			// it is exactly what the old drop-the-record behavior cost.
			if primary["unique_id"] != "u" {
				t.Errorf("photos.primary.unique_id = %#v, want it preserved", primary["unique_id"])
			}

			urls, hasURLs := primary["urls"]
			if hasURLs != tt.wantURLs {
				t.Fatalf("photos.primary.urls present=%v (%#v), want present=%v", hasURLs, urls, tt.wantURLs)
			}
			if !tt.wantURLs {
				// Omitted, never "" — the subscription accepts null/absent for a
				// JSON column but rejects an empty string.
				return
			}

			encoded, isString := urls.(string)
			if !isString {
				t.Fatalf("photos.primary.urls = %#v, want JSON text (a string), not a nested object", urls)
			}
			var decoded map[string]string
			if err := json.Unmarshal([]byte(encoded), &decoded); err != nil {
				t.Fatalf("photos.primary.urls is not valid JSON text: %v (%q)", err, encoded)
			}
			if decoded["100"] != "https://example.test/a.jpg" {
				t.Errorf("urls round-tripped to %#v, want the original entries", decoded)
			}
		})
	}
}

// The activity payload arrives from Strava, not from us — malformed input must
// come back as an error the best-effort caller can drop, never as a message
// that dead-letters or a panic that unwinds the handler.
func TestUpsert_RejectsUnusablePayloads(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr error
	}{
		{name: "malformed JSON", raw: `{"id": 1`},
		{name: "empty input", raw: ``},
		{name: "JSON array", raw: `[{"id": 1}]`},
		{name: "JSON null", raw: `null`, wantErr: ErrNoActivityID},
		{name: "empty object", raw: `{}`, wantErr: ErrNoActivityID},
		{name: "null id", raw: `{"id": null, "name": "x"}`, wantErr: ErrNoActivityID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := Upsert([]byte(tt.raw), testSeq)
			if err == nil {
				t.Fatalf("Upsert() = %s, want an error", body)
			}
			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Errorf("Upsert() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

// A delete carries the primary key and nothing else — that is what lets it be
// published for an activity Strava has already removed.
func TestDelete(t *testing.T) {
	body, err := Delete(12345678987654321, testSeq)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	row := decodeRow(t, body)

	if len(row) != 3 {
		t.Errorf("delete body has %d fields (%v), want exactly id + the two CDC fields", len(row), row)
	}
	id, ok := row["id"].(json.Number)
	if !ok || id.String() != "12345678987654321" {
		t.Errorf("id = %#v, want 12345678987654321", row["id"])
	}
	if got := row["_CHANGE_TYPE"]; got != ChangeTypeDelete {
		t.Errorf("_CHANGE_TYPE = %v, want %q", got, ChangeTypeDelete)
	}
	if got := row["_CHANGE_SEQUENCE_NUMBER"]; got != testSeq {
		t.Errorf("_CHANGE_SEQUENCE_NUMBER = %v, want %q", got, testSeq)
	}
}

// BigQuery accepts at most four "/"-separated sections of at most 16 hex
// characters each.
var sequenceNumberFormat = regexp.MustCompile(`^[0-9A-F]{16}/[0-9A-F]{16}$`)

func TestSequenceNumber_Format(t *testing.T) {
	tests := []struct {
		name     string
		event    int64
		tiebreak time.Time
	}{
		{name: "typical", event: 1755000000, tiebreak: time.Unix(1755000001, 123456789)},
		{name: "zero", event: 0, tiebreak: time.Unix(0, 0)},
		{name: "negative clamps rather than emitting -hex", event: -1, tiebreak: time.Unix(0, -1)},
		{name: "far future", event: 1<<40 - 1, tiebreak: time.Unix(1<<40, 0)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SequenceNumber(tt.event, tt.tiebreak)
			if !sequenceNumberFormat.MatchString(got) {
				t.Errorf("SequenceNumber() = %q, want two 16-char uppercase hex sections", got)
			}
		})
	}
}

// BigQuery resolves competing writes by taking the largest sequence number, so
// a later event must always sort above an earlier one as a plain string.
func TestSequenceNumber_OrdersByEventTimeThenArrival(t *testing.T) {
	base := time.Unix(1755000000, 0)

	older := SequenceNumber(1755000000, base)
	newer := SequenceNumber(1755000001, base)
	if older >= newer {
		t.Errorf("event_time ordering broken: %q should sort below %q", older, newer)
	}

	// Same Strava second: arrival order decides.
	first := SequenceNumber(1755000000, base)
	second := SequenceNumber(1755000000, base.Add(time.Millisecond))
	if first >= second {
		t.Errorf("arrival tiebreak broken: %q should sort below %q", first, second)
	}

	// A later Strava event wins even when it arrives first — the point of
	// sequencing rather than trusting delivery order.
	late := SequenceNumber(1755000009, base)
	early := SequenceNumber(1755000000, base.Add(time.Hour))
	if early >= late {
		t.Errorf("event_time must dominate arrival: %q should sort below %q", early, late)
	}
}

// The subscription drops fields the table has no column for, but a REQUIRED
// column that never arrives fails the whole message. Locking the fixture
// against the real schema means a mapping change that starts filtering fields
// fails here rather than in the dead-letter topic.
func TestUpsert_CarriesEveryRequiredColumn(t *testing.T) {
	required := requiredTopLevelColumns(t)
	if len(required) == 0 {
		t.Fatalf("no REQUIRED columns found in %s — schema parse is wrong", bqSchemaPath)
	}

	row := mustUpsert(t, rawActivity)
	for _, column := range required {
		value, present := row[column]
		if !present {
			t.Errorf("REQUIRED column %q is missing from the published row", column)
			continue
		}
		if value == nil {
			t.Errorf("REQUIRED column %q is null in the published row", column)
		}
	}
}

// requiredTopLevelColumns reads the destination table's schema and returns the
// names of its top-level REQUIRED columns.
func requiredTopLevelColumns(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(bqSchemaPath))
	if err != nil {
		t.Fatalf("read BigQuery schema: %v", err)
	}

	var schema struct {
		Schema []struct {
			Name string `json:"name"`
			Mode string `json:"mode"`
		} `json:"schema"`
	}
	if parseErr := json.Unmarshal(raw, &schema); parseErr != nil {
		t.Fatalf("parse BigQuery schema: %v", parseErr)
	}

	columns := make([]string, 0, len(schema.Schema))
	for _, field := range schema.Schema {
		if field.Mode == "REQUIRED" {
			columns = append(columns, field.Name)
		}
	}
	return columns
}
