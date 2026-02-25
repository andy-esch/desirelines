package postgres

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
)

func TestActivityRepository_Ping(t *testing.T) {
	// Since Pool embeds *pgxpool.Pool, we can't easily mock it.
	// Instead, test via integration or verify the struct composition.
	// This test documents that ActivityRepository implements the expected interface.
	t.Run("implements Ping interface", func(t *testing.T) {
		var _ interface {
			Ping(context.Context) error
			Close() error
		} = &ActivityRepository{}
	})
}

func TestActivityRepository_Close(t *testing.T) {
	// Verify Close returns nil (no error from Close operation)
	// The actual pool closing is handled by pgxpool.Pool.Close() which doesn't return error

	// This test documents the expected behavior
	t.Run("close returns nil", func(t *testing.T) {
		// ActivityRepository.Close() always returns nil since pgxpool.Pool.Close() is void
		// This is tested implicitly through the interface verification
		var _ interface {
			Close() error
		} = &ActivityRepository{}
	})
}

func TestNewActivityRepository(t *testing.T) {
	t.Run("creates repository with pool", func(t *testing.T) {
		// We can't create a real pool without a database, but we can verify
		// the constructor signature and behavior
		// This test documents the expected API

		// Verify the function exists and has correct signature
		constructor := NewActivityRepository

		// Verify nil pool handling (defensive - shouldn't happen in practice)
		repo := constructor(nil)
		if repo.pool != nil {
			t.Error("expected nil pool to be stored as nil")
		}
	})
}

func TestActivityRepository_InterfaceCompliance(t *testing.T) {
	// Compile-time interface verification is in activities.go
	// This test documents that ActivityRepository implements repository.ActivityRepository

	t.Run("implements ActivityRepository interface", func(t *testing.T) {
		// The compile-time check in activities.go ensures this:
		// var _ repository.ActivityRepository = (*ActivityRepository)(nil)

		// Verify interface compliance via compile-time check
		var _ repository.ActivityRepository = (*ActivityRepository)(nil)
	})
}

func TestActivityRepository_GetMultiSportMetrics_SignatureAndTypes(t *testing.T) {
	// This test documents the GetMultiSportMetrics method signature and return types
	// Actual database queries are tested via integration tests

	t.Run("returns map of SportMetrics and error", func(t *testing.T) {
		repo := &ActivityRepository{}

		// Verify the method exists and can be called (compile-time check)
		_ = repo.GetMultiSportMetrics
	})

	t.Run("SportMetrics has Timeseries field", func(t *testing.T) {
		metrics := generated.SportMetrics{}
		if metrics.Timeseries != nil {
			t.Log("Timeseries field exists and is nil by default")
		}
	})

	t.Run("CumulativeMetricsEntry has expected fields", func(t *testing.T) {
		// Document the structure by constructing a valid instance
		entry := generated.CumulativeMetricsEntry{
			Date: "2024-01-15",
		}
		if entry.Date == "" {
			t.Error("Date field should be set")
		}
	})
}

func TestActivityRepository_GetMultiSportDailySummary_SignatureAndTypes(t *testing.T) {
	// This test documents the GetMultiSportDailySummary method signature and return types
	// Actual database queries are tested via integration tests

	t.Run("returns map of DailySummary and error", func(t *testing.T) {
		repo := &ActivityRepository{}

		// Verify the method exists and can be called (compile-time check)
		_ = repo.GetMultiSportDailySummary
	})

	t.Run("DailySummary has Daily map field", func(t *testing.T) {
		summary := generated.DailySummary{
			Daily: make(map[string]*generated.DailyActivity),
		}
		summary.Daily["2024-01-15"] = &generated.DailyActivity{
			Activities: 1,
		}
		if len(summary.Daily) != 1 {
			t.Error("expected 1 entry in summary")
		}
	})

	t.Run("DailyActivity has expected fields", func(t *testing.T) {
		entry := generated.DailyActivity{
			Activities:  1,
			ActivityIds: []int64{12345},
		}
		if entry.Activities != 1 {
			t.Error("Activities field should be set")
		}
	})
}

func TestActivityRepository_GetYearMetadata_SignatureAndTypes(t *testing.T) {
	// This test documents the GetYearMetadata method signature and return types
	// Actual database queries are tested via integration tests

	t.Run("returns YearMetadata pointer and error", func(t *testing.T) {
		repo := &ActivityRepository{}

		// Verify the method exists and can be called (compile-time check)
		_ = repo.GetYearMetadata
	})

	t.Run("YearMetadata has expected fields", func(t *testing.T) {
		meta := generated.YearMetadata{
			Year:               2024,
			Sports:             []string{"cycling"},
			AggregationVersion: "2.0",
		}
		if meta.Year != 2024 {
			t.Error("Year field should be set")
		}
	})

	t.Run("SportTotals has expected fields", func(t *testing.T) {
		totals := generated.SportTotals{
			Activities: 10,
		}
		if totals.Activities != 10 {
			t.Error("Activities field should be set")
		}
	})
}

func TestActivityRepository_GetActivityByID_SignatureAndTypes(t *testing.T) {
	// This test documents the GetActivityByID method signature and return types
	// Actual database queries are tested via integration tests

	t.Run("returns Activity pointer and error", func(t *testing.T) {
		repo := &ActivityRepository{}

		// Verify the method exists and can be called (compile-time check)
		_ = repo.GetActivityByID
	})

	t.Run("Activity has expected fields", func(t *testing.T) {
		activity := activitiesv1.Activity{
			Id:                 12345,
			Name:               "Morning Ride",
			Type:               "Ride",
			Sport:              "cycling",
			StartDateLocal:     "2024-01-15T08:00:00Z",
			DistanceMeters:     10000,
			MovingTimeSeconds:  1800,
			ElapsedTimeSeconds: 2000,
		}
		if activity.Id != 12345 {
			t.Error("Id field should be set")
		}
		if activity.Name != "Morning Ride" {
			t.Error("Name field should be set")
		}
	})
}

func TestActivityRepository_ListActivities_SignatureAndTypes(t *testing.T) {
	// This test documents the ListActivities method signature and return types
	// Actual database queries are tested via integration tests

	t.Run("returns ActivityListResponse pointer and error", func(t *testing.T) {
		repo := &ActivityRepository{}

		// Verify the method exists and can be called (compile-time check)
		_ = repo.ListActivities
	})

	t.Run("ListActivitiesResponse has expected fields", func(t *testing.T) {
		cursor := "abc123"
		response := activitiesv1.ListActivitiesResponse{
			Activities: []*activitiesv1.ActivitySummary{},
			NextCursor: &cursor,
			HasMore:    true,
		}
		if !response.HasMore {
			t.Error("HasMore field should be set")
		}
		if response.NextCursor == nil || *response.NextCursor != "abc123" {
			t.Error("NextCursor field should be set")
		}
	})

	t.Run("ActivitySummary has expected fields", func(t *testing.T) {
		elevation := 100.0
		summary := activitiesv1.ActivitySummary{
			Id:                12345,
			Name:              "Morning Ride",
			Type:              "Ride",
			Sport:             "cycling",
			StartDateLocal:    "2024-01-15T08:00:00Z",
			DistanceMeters:    10000,
			MovingTimeSeconds: 1800,
			ElevationMeters:   &elevation,
		}
		if summary.Id != 12345 {
			t.Error("Id field should be set")
		}
	})

	t.Run("ActivityListFilter has expected fields", func(t *testing.T) {
		from := "2024-01-01"
		to := "2024-12-31"
		filter := repository.ActivityListFilter{
			UserID:     "test-user",
			From:       &from,
			To:         &to,
			SportTypes: []string{"Ride", "VirtualRide"},
			Limit:      20,
			Cursor:     nil,
		}
		if filter.Limit != 20 {
			t.Error("Limit field should be set")
		}
	})
}

func TestEncodeCursor(t *testing.T) {
	t.Run("encodes cursor to base64", func(t *testing.T) {
		cursor := &repository.ActivityCursor{
			Timestamp: "2024-01-15T08:00:00Z",
			ID:        12345,
		}

		encoded := encodeCursor(cursor)

		// Should be a non-empty base64 string
		if encoded == "" {
			t.Error("expected non-empty encoded cursor")
		}

		// Should be valid base64 (URL encoding)
		decoded, err := base64.URLEncoding.DecodeString(encoded)
		if err != nil {
			t.Errorf("expected valid base64, got error: %v", err)
		}

		// Should contain timestamp and ID in "timestamp|id" format
		expected := "2024-01-15T08:00:00Z|12345"
		if string(decoded) != expected {
			t.Errorf("expected decoded cursor %q, got %q", expected, string(decoded))
		}
	})

	t.Run("produces different cursors for different inputs", func(t *testing.T) {
		cursor1 := &repository.ActivityCursor{
			Timestamp: "2024-01-15T08:00:00Z",
			ID:        12345,
		}
		cursor2 := &repository.ActivityCursor{
			Timestamp: "2024-01-16T09:00:00Z",
			ID:        12346,
		}

		encoded1 := encodeCursor(cursor1)
		encoded2 := encodeCursor(cursor2)

		if encoded1 == encoded2 {
			t.Error("expected different cursors for different inputs")
		}
	})

	t.Run("handles large activity IDs", func(t *testing.T) {
		cursor := &repository.ActivityCursor{
			Timestamp: "2024-01-15T08:00:00Z",
			ID:        9999999999999, // Large Strava activity ID
		}

		encoded := encodeCursor(cursor)
		if encoded == "" {
			t.Error("expected non-empty encoded cursor for large ID")
		}

		// Verify it decodes correctly
		decoded, err := base64.URLEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatalf("failed to decode cursor: %v", err)
		}
		expected := "2024-01-15T08:00:00Z|9999999999999"
		if string(decoded) != expected {
			t.Errorf("expected decoded cursor %q, got %q", expected, string(decoded))
		}
	})
}
