package repository

import (
	"testing"
)

// Note: JSON serialization tests for Activity and ActivitySummary have been
// moved to the protojson layer since these types are now defined in the
// activitiesv1 proto package. See internal/activities/helper_test.go for
// protobuf serialization tests.

func TestActivityCursor_Fields(t *testing.T) {
	// Verify cursor struct has expected fields
	cursor := ActivityCursor{
		Timestamp: "2025-01-01T12:00:00Z",
		ID:        123456,
	}

	if cursor.Timestamp != "2025-01-01T12:00:00Z" {
		t.Errorf("got timestamp %s, want 2025-01-01T12:00:00Z", cursor.Timestamp)
	}
	if cursor.ID != 123456 {
		t.Errorf("got id %d, want 123456", cursor.ID)
	}
}

func TestActivityListFilter_Defaults(t *testing.T) {
	// Verify filter zero values
	filter := ActivityListFilter{}

	if filter.From != nil {
		t.Error("expected From to be nil by default")
	}
	if filter.To != nil {
		t.Error("expected To to be nil by default")
	}
	if len(filter.SportTypes) != 0 {
		t.Error("expected SportTypes to be empty by default")
	}
	if filter.Limit != 0 {
		t.Error("expected Limit to be 0 by default")
	}
	if filter.Cursor != nil {
		t.Error("expected Cursor to be nil by default")
	}
}
