package bqrow

import (
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
	row, err := decodeActivity(rawActivity)
	if err != nil {
		return nil, err
	}

	normalize(row)
	row[fieldChangeType] = ChangeTypeUpsert
	row[fieldChangeSeq] = sequenceNumber

	body, marshalErr := json.Marshal(row)
	if marshalErr != nil {
		return nil, fmt.Errorf("marshal activity row: %w", marshalErr)
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

	// photos.primary.urls is a JSON column, and the subscription wants JSON
	// *text* for one — not the nested object Strava sends. Passing the object
	// through rejects the entire message with invalid_argument, so every
	// activity that has a photo silently dead-letters while photo-less ones
	// succeed. BigQuery parses the text back into a JSON object on arrival, so
	// the stored shape is the same either way; only the wire form differs.
	//
	// A primary photo with no usable urls keeps its record and simply omits
	// `urls`. `photos.primary.urls` is NULLABLE on activities_live (and the
	// CDC proto has it `optional`), so the row is accepted either way — and
	// omitting just the one bad field preserves id/media_type/source/unique_id,
	// which dropping the record threw away. Omitted rather than "": the
	// subscription accepts null/absent for a JSON column but not an empty
	// string (see bigquery_subscription.tf).
	photos, ok := row["photos"].(map[string]any)
	if !ok {
		return
	}
	primary, ok := photos["primary"].(map[string]any)
	if !ok {
		return
	}
	encoded, ok := encodePhotoURLs(primary["urls"])
	if !ok {
		delete(primary, "urls")
		return
	}
	primary["urls"] = encoded
}

// encodePhotoURLs renders a photos.primary.urls value as the JSON text the
// destination column expects. Reports false when there is nothing worth
// sending, which the caller turns into a dropped primary photo.
//
// A value that is already a string is passed through: it is either JSON text
// from an earlier encoding, or the empty string that stands for "no urls".
func encodePhotoURLs(urls any) (string, bool) {
	switch v := urls.(type) {
	case map[string]any:
		if len(v) == 0 {
			return "", false
		}
		encoded, err := json.Marshal(v)
		if err != nil {
			// Values came from decoding Strava's JSON, so they re-encode; a
			// failure here means something unexpected, and dropping the photo
			// is better than failing the whole row.
			return "", false
		}
		return string(encoded), true
	case string:
		return v, v != ""
	default:
		return "", false
	}
}
