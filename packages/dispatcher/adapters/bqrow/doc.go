// Package bqrow maps Strava's raw activity JSON onto the message body a
// BigQuery change-data-capture subscription applies to the activities table.
//
// # Why the raw JSON is re-published almost verbatim
//
// The subscription is configured with use_table_schema, so Pub/Sub matches
// message fields to destination-table columns by name and drops fields the
// table has no column for (drop_unknown_fields). Strava's detailed-activity
// payload is already shaped like that table, so the mapping is a pass-through
// plus the two CDC fields and the small number of type fixes documented on
// [normalize].
//
// # CDC fields
//
// CDC is implicit: the destination table declares a primary key, so a message
// body carrying _CHANGE_TYPE is applied as an upsert or a delete instead of an
// append. Both fields live in the message BODY, not in Pub/Sub attributes.
//
//   - _CHANGE_TYPE — [ChangeTypeUpsert] or [ChangeTypeDelete].
//   - _CHANGE_SEQUENCE_NUMBER — the ordering key; see [SequenceNumber].
//
// # Usage
//
//	seq := bqrow.SequenceNumber(webhook.EventTime, time.Now())
//	body, err := bqrow.Upsert(enriched.RawActivity, seq)   // full-row replace
//	body, err := bqrow.Delete(webhook.ObjectId, seq)       // key-only delete
//
// Upsert replaces the whole row, so it must only be called with a complete
// activity payload — never with a partial one, which would blank every column
// the partial omits.
package bqrow
