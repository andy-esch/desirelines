package bqrow

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// The protobuf encoding of the same rows [Upsert] and [Delete] produce as JSON.
//
// A schema-bound topic validates every message at publish time, so a row that
// does not fit the table is rejected by Pub/Sub rather than accepted, delivered
// and dead-lettered minutes later by BigQuery. That is the whole point of
// moving: the two field-type mismatches this package normalizes were both
// found the slow way, from dead letters.
//
// The message shape is generated from the same BigQuery table schema as the
// JSON path, so both encodings carry identical rows. Only the wire format and
// where errors surface differ.

// UpsertProto builds the protobuf body that replaces an activity's row.
//
// Strava's payload is normalized exactly as the JSON path normalizes it — the
// column types it has to satisfy are the same — and then decoded into the
// generated message. Fields Strava sends that the table has no column for are
// discarded here rather than at the subscription.
//
// Returns [ErrNoActivityID] if the payload carries no "id".
func UpsertProto(rawActivity []byte, sequenceNumber string) ([]byte, error) {
	row, err := decodeActivity(rawActivity)
	if err != nil {
		return nil, err
	}
	normalize(row)

	normalized, err := json.Marshal(row)
	if err != nil {
		return nil, fmt.Errorf("marshal normalized activity: %w", err)
	}

	var msg generated.ActivityRow
	// DiscardUnknown stands in for the subscription's drop_unknown_fields: a
	// detailed activity carries plenty Strava sends and the table does not want.
	if decodeErr := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(normalized, &msg); decodeErr != nil {
		return nil, fmt.Errorf("decode activity into row message: %w", decodeErr)
	}

	msg.XCHANGE_TYPE = proto.String(ChangeTypeUpsert)
	msg.XCHANGE_SEQUENCE_NUMBER = proto.String(sequenceNumber)

	body, err := proto.Marshal(&msg)
	if err != nil {
		return nil, fmt.Errorf("marshal activity row message: %w", err)
	}
	return body, nil
}

// DeleteProto builds the protobuf body that removes an activity's row. As with
// the JSON encoding, a CDC delete matches on the primary key alone, so nothing
// but the id is set — which is what lets it be published for an activity Strava
// has already dropped.
func DeleteProto(activityID int64, sequenceNumber string) ([]byte, error) {
	msg := generated.ActivityRow{
		Id:                      proto.Int64(activityID),
		XCHANGE_TYPE:            proto.String(ChangeTypeDelete),
		XCHANGE_SEQUENCE_NUMBER: proto.String(sequenceNumber),
	}
	body, err := proto.Marshal(&msg)
	if err != nil {
		return nil, fmt.Errorf("marshal activity delete message: %w", err)
	}
	return body, nil
}

// decodeActivity parses a raw Strava activity, preserving integer precision.
//
// UseNumber matters: decoding into float64 re-encodes large activity IDs in
// exponent notation and silently rounds them, which would key an upsert to the
// wrong row.
func decodeActivity(rawActivity []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(rawActivity))
	decoder.UseNumber()

	var row map[string]any
	if err := decoder.Decode(&row); err != nil {
		return nil, fmt.Errorf("decode raw activity: %w", err)
	}
	if row[fieldID] == nil {
		return nil, ErrNoActivityID
	}
	return row, nil
}

// Encoding selects the wire format for activity-row messages.
//
// The two are interchangeable in content and differ only in where a malformed
// row is caught: JSON reaches the subscription and fails at BigQuery minutes
// later, while a schema-bound topic rejects protobuf at publish time. Both
// exist so the topic's schema and the producer's output can be switched over
// together, and so the switch can be reversed without a deploy.
type Encoding string

// The supported wire formats. Encoding is validated at config load, so an
// unrecognized value fails the dispatcher's boot rather than silently
// selecting one of these.
const (
	EncodingJSON  Encoding = "json"
	EncodingProto Encoding = "proto"
)

// Valid reports whether e is a known encoding.
func (e Encoding) Valid() bool {
	return e == EncodingJSON || e == EncodingProto
}

// BuildUpsert renders an activity as a full-row upsert in the given encoding.
func BuildUpsert(enc Encoding, rawActivity []byte, sequenceNumber string) ([]byte, error) {
	if enc == EncodingProto {
		return UpsertProto(rawActivity, sequenceNumber)
	}
	return Upsert(rawActivity, sequenceNumber)
}

// BuildDelete renders a row removal in the given encoding.
func BuildDelete(enc Encoding, activityID int64, sequenceNumber string) ([]byte, error) {
	if enc == EncodingProto {
		return DeleteProto(activityID, sequenceNumber)
	}
	return Delete(activityID, sequenceNumber)
}
