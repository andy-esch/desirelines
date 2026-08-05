package bqrow

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"google.golang.org/protobuf/proto"
)

// decodeRowMessage parses producer output back into the generated message, the
// way Pub/Sub and BigQuery will.
func decodeRowMessage(t *testing.T, body []byte) *generated.ActivityRow {
	t.Helper()
	var msg generated.ActivityRow
	if err := proto.Unmarshal(body, &msg); err != nil {
		t.Fatalf("decode row message: %v", err)
	}
	return &msg
}

func mustUpsertProto(t *testing.T) *generated.ActivityRow {
	t.Helper()
	body, err := UpsertProto([]byte(rawActivity), testSeq)
	if err != nil {
		t.Fatalf("UpsertProto() error = %v", err)
	}
	return decodeRowMessage(t, body)
}

func TestUpsertProto_SetsCDCFields(t *testing.T) {
	msg := mustUpsertProto(t)

	if got := msg.GetXCHANGE_TYPE(); got != ChangeTypeUpsert {
		t.Errorf("_CHANGE_TYPE = %q, want %q", got, ChangeTypeUpsert)
	}
	if got := msg.GetXCHANGE_SEQUENCE_NUMBER(); got != testSeq {
		t.Errorf("_CHANGE_SEQUENCE_NUMBER = %q, want %q", got, testSeq)
	}
}

// The same precision hazard the JSON encoding has: a float64 round trip would
// round a large activity ID and key the upsert to the wrong row.
func TestUpsertProto_PreservesLargeIntegerID(t *testing.T) {
	msg := mustUpsertProto(t)

	if got := msg.GetId(); got != 12345678987654321 {
		t.Errorf("id = %d, want 12345678987654321", got)
	}
}

func TestUpsertProto_PreservesNestedAndRepeatedFields(t *testing.T) {
	msg := mustUpsertProto(t)

	if got := msg.GetMap().GetPolyline(); got != "kwriFrflkVvBHi@?j@?" {
		t.Errorf("map.polyline = %q, want the full polyline", got)
	}
	if got := msg.GetAthlete().GetId(); got != 134815 {
		t.Errorf("athlete.id = %d, want 134815", got)
	}
	if got := len(msg.GetStartLatlng()); got != 2 {
		t.Errorf("start_latlng has %d entries, want 2", got)
	}
	if got := len(msg.GetSplitsMetric()); got != 2 {
		t.Errorf("splits_metric has %d entries, want 2", got)
	}
	// TIMESTAMP columns are strings in this encoding, so Strava's RFC 3339
	// values pass through with no conversion.
	if got := msg.GetStartDate(); got != "2018-02-16T14:52:54Z" {
		t.Errorf("start_date = %q, want Strava's value unchanged", got)
	}
}

// Both are required, not defensive: protojson rejects a JSON number for a
// string field and an object for a string field, so an un-normalized payload
// fails to encode at all.
func TestUpsertProto_AppliesTheColumnTypeCoercions(t *testing.T) {
	msg := mustUpsertProto(t)

	if got := msg.GetWorkoutType(); got != "10" {
		t.Errorf("workout_type = %q, want the number rendered as a string", got)
	}

	urls := msg.GetPhotos().GetPrimary().GetUrls()
	var decoded map[string]string
	if err := json.Unmarshal([]byte(urls), &decoded); err != nil {
		t.Fatalf("photos.primary.urls is not JSON text: %v (%q)", err, urls)
	}
	if decoded["100"] != "https://example.test/100.jpg" {
		t.Errorf("urls round-tripped to %#v, want the original entries", decoded)
	}
}

// A delete addresses the row by primary key alone, which is what lets it be
// published for an activity Strava has already removed.
func TestDeleteProto(t *testing.T) {
	body, err := DeleteProto(12345678987654321, testSeq)
	if err != nil {
		t.Fatalf("DeleteProto() error = %v", err)
	}
	msg := decodeRowMessage(t, body)

	if got := msg.GetId(); got != 12345678987654321 {
		t.Errorf("id = %d, want 12345678987654321", got)
	}
	if got := msg.GetXCHANGE_TYPE(); got != ChangeTypeDelete {
		t.Errorf("_CHANGE_TYPE = %q, want %q", got, ChangeTypeDelete)
	}
	if got := msg.GetXCHANGE_SEQUENCE_NUMBER(); got != testSeq {
		t.Errorf("_CHANGE_SEQUENCE_NUMBER = %q, want %q", got, testSeq)
	}
	// Nothing else may be set: a populated column here would overwrite real
	// data if BigQuery ever applied the message as an upsert.
	if msg.GetName() != "" || msg.GetSportType() != "" || msg.GetAthlete() != nil {
		t.Errorf("delete carries payload fields: name=%q sport=%q athlete=%v",
			msg.GetName(), msg.GetSportType(), msg.GetAthlete())
	}
}

func TestUpsertProto_RejectsUnusablePayloads(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr error
	}{
		{name: "malformed JSON", raw: `{"id": 1`},
		{name: "empty input", raw: ``},
		{name: "JSON null", raw: `null`, wantErr: ErrNoActivityID},
		{name: "empty object", raw: `{}`, wantErr: ErrNoActivityID},
		{name: "null id", raw: `{"id": null, "name": "x"}`, wantErr: ErrNoActivityID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := UpsertProto([]byte(tt.raw), testSeq)
			if err == nil {
				t.Fatalf("UpsertProto() = %d bytes, want an error", len(body))
			}
			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Errorf("UpsertProto() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

// The repo's real Strava captures, which carry far more than the trimmed
// fixture above — segment efforts, laps, gear, photos, stats visibility. These
// same payloads were validated against Pub/Sub's schema checker with
// `gcloud pubsub schemas validate-message`; this keeps them encoding cleanly.
func TestUpsertProto_RealStravaFixtures(t *testing.T) {
	for _, name := range []string{"activity_1", "activity_2"} {
		t.Run(name, func(t *testing.T) {
			// #nosec G304 -- fixture path built from the literal names above.
			raw, err := os.ReadFile("../../../stravapipe/tests/fixtures/" + name + ".json")
			if err != nil {
				t.Skipf("fixture unavailable: %v", err)
			}
			body, err := UpsertProto(raw, testSeq)
			if err != nil {
				t.Fatalf("UpsertProto() error = %v", err)
			}
			msg := decodeRowMessage(t, body)
			if msg.GetId() == 0 {
				t.Error("id is unset")
			}
			if msg.GetStartDate() == "" {
				t.Error("start_date is unset — the TIMESTAMP mapping regressed")
			}
			if msg.GetXCHANGE_TYPE() != ChangeTypeUpsert {
				t.Error("_CHANGE_TYPE is unset")
			}
		})
	}
}

// Every row carries the CDC primary key. The proto cannot enforce that —
// proto2 `required` is refused by Pub/Sub's schema-revision compatibility check
// — so the producer is the only guard, and this pins both paths to it.
func TestActivityRow_AlwaysCarriesThePrimaryKey(t *testing.T) {
	upsert, err := UpsertProto([]byte(rawActivity), testSeq)
	if err != nil {
		t.Fatalf("UpsertProto() error = %v", err)
	}
	if decodeRowMessage(t, upsert).GetId() == 0 {
		t.Error("upsert produced no id")
	}

	del, err := DeleteProto(42, testSeq)
	if err != nil {
		t.Fatalf("DeleteProto() error = %v", err)
	}
	if decodeRowMessage(t, del).GetId() != 42 {
		t.Error("delete produced no id")
	}

	// A payload with no id never reaches the wire at all.
	if _, keyErr := UpsertProto([]byte(`{"name":"no id"}`), testSeq); !errors.Is(keyErr, ErrNoActivityID) {
		t.Errorf("UpsertProto without an id = %v, want ErrNoActivityID", keyErr)
	}
}
