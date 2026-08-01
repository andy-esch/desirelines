package bqrow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// CDC change types accepted by BigQuery. The pseudocolumn takes no other value.
const (
	ChangeTypeUpsert = "UPSERT"
	ChangeTypeDelete = "DELETE"
)

// BigQuery's CDC pseudocolumns, carried as ordinary fields in the message body.
const (
	fieldChangeType = "_CHANGE_TYPE"
	fieldChangeSeq  = "_CHANGE_SEQUENCE_NUMBER"
	fieldID         = "id"
)

// ErrNoActivityID is returned when a payload has no "id" — the CDC primary key.
// Without it BigQuery cannot address a row, so the message is not publishable.
var ErrNoActivityID = errors.New("activity payload has no id")

// SequenceNumber formats a _CHANGE_SEQUENCE_NUMBER: hexadecimal sections
// separated by "/", at most four sections of at most 16 hex characters each.
// BigQuery compares them section by section as unsigned numeric values and
// applies the largest one per primary key, so out-of-order delivery still
// converges on the newest event.
//
// Section 1 is the Strava webhook's event_time (Unix seconds): the event
// Strava stamped later always wins. Section 2 is a local timestamp in
// nanoseconds, which only breaks ties among events Strava stamped within the
// same second — there, "whichever this process handled last" is the best
// ordering available. Both sections are clamped at zero because a negative
// value has no valid hexadecimal encoding here.
func SequenceNumber(eventTime int64, tiebreak time.Time) string {
	return fmt.Sprintf("%016X/%016X", clampToUint64(eventTime), clampToUint64(tiebreak.UnixNano()))
}

func clampToUint64(v int64) uint64 {
	if v < 0 {
		return 0
	}
	return uint64(v)
}

// Upsert builds the message body that replaces an activity's row, from the raw
// JSON of a Strava detailed activity. The payload must be complete: a CDC
// upsert overwrites every column, so a partial one silently blanks the rest.
//
// Returns [ErrNoActivityID] if the payload carries no "id".
func Upsert(rawActivity []byte, sequenceNumber string) ([]byte, error) {
	// UseNumber keeps integer literals exactly as Strava sent them. Decoding
	// into float64 would re-encode large IDs in exponent notation, which
	// BigQuery rejects for an INTEGER column.
	decoder := json.NewDecoder(bytes.NewReader(rawActivity))
	decoder.UseNumber()

	var row map[string]any
	if err := decoder.Decode(&row); err != nil {
		return nil, fmt.Errorf("decode raw activity: %w", err)
	}
	if row[fieldID] == nil {
		return nil, ErrNoActivityID
	}

	normalize(row)
	row[fieldChangeType] = ChangeTypeUpsert
	row[fieldChangeSeq] = sequenceNumber

	body, err := json.Marshal(row)
	if err != nil {
		return nil, fmt.Errorf("marshal activity row: %w", err)
	}
	return body, nil
}

// Delete builds the message body that removes an activity's row. CDC deletes
// match on the primary key alone, so nothing but the id is needed — which is
// what makes deletes publishable for an activity Strava has already dropped.
func Delete(activityID int64, sequenceNumber string) ([]byte, error) {
	body, err := json.Marshal(map[string]any{
		fieldID:         activityID,
		fieldChangeType: ChangeTypeDelete,
		fieldChangeSeq:  sequenceNumber,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal activity delete: %w", err)
	}
	return body, nil
}

// normalize reconciles the two places where Strava's JSON types disagree with
// the destination table's column types. Everything else is left untouched:
// columns absent from the payload land NULL, and payload fields absent from
// the table are dropped by the subscription's drop_unknown_fields.
//
// A mismatch here is not cosmetic — the subscription rejects the whole message
// and it lands in the dead-letter topic.
func normalize(row map[string]any) {
	// workout_type is a STRING column, but Strava sends the run/ride workout
	// code as a number. The BigQuery writer on the existing pipeline performs
	// the same coercion.
	if n, ok := row["workout_type"].(json.Number); ok {
		row["workout_type"] = n.String()
	}

	// photos.primary.urls is a JSON column and a REQUIRED field, so a primary
	// photo whose urls are empty or missing would fail the whole row. Such a
	// photo carries nothing anyway; drop it and keep the rest of the activity.
	photos, ok := row["photos"].(map[string]any)
	if !ok {
		return
	}
	primary, ok := photos["primary"].(map[string]any)
	if !ok {
		return
	}
	if !hasPhotoURLs(primary["urls"]) {
		photos["primary"] = nil
	}
}

// hasPhotoURLs reports whether a photos.primary.urls value is worth sending.
// The empty string is called out explicitly: it is what an over-eager
// serializer produces for "no urls", and BigQuery stores it as an empty JSON
// string rather than the NULL the caller meant.
func hasPhotoURLs(urls any) bool {
	switch v := urls.(type) {
	case map[string]any:
		return len(v) > 0
	case string:
		return v != ""
	default:
		return false
	}
}
