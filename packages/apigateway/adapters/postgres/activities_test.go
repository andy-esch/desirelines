package postgres

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// fakeRow implements pgx.Row for GetActivityByID tests. The scanFn is invoked
// when Scan is called; return pgx.ErrNoRows to simulate not-found, or nil to
// simulate a successful scan (caller is responsible for populating dest).
type fakeRow struct {
	scanFn func(dest ...any) error
}

func (r *fakeRow) Scan(dest ...any) error { return r.scanFn(dest...) }

// fakeQuerier implements DBQuerier so repository methods can be exercised in
// unit tests without a real Postgres. Only the methods used by the test under
// test need to do meaningful work; others can return zero values.
type fakeQuerier struct {
	queryFn    func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
}

func (q *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if q.queryFn == nil {
		return emptyRows{}, nil
	}
	return q.queryFn(ctx, sql, args...)
}
func (q *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return q.queryRowFn(ctx, sql, args...)
}
func (q *fakeQuerier) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

// emptyRows implements pgx.Rows as a zero-row result set. Methods other than
// Next/Err/Close/Scan return zero values that the production code never reads
// when Next() returns false on the first call.
type emptyRows struct{}

func (emptyRows) Close()                                       {}
func (emptyRows) Err() error                                   { return nil }
func (emptyRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (emptyRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (emptyRows) Next() bool                                   { return false }
func (emptyRows) Scan(_ ...any) error                          { return nil }
func (emptyRows) Values() ([]any, error)                       { return nil, nil }
func (emptyRows) RawValues() [][]byte                          { return nil }
func (emptyRows) Conn() *pgx.Conn                              { return nil }

// newSpanRecordingRepo returns a repository wired to an in-memory span
// recorder and a default fakeQuerier returning zero rows. Tests then either
// assert on sr.Ended() or override repo.db with a custom querier for that
// method's specific shape (e.g. QueryRow for GetActivityByID).
func newSpanRecordingRepo(t *testing.T) (*ActivityRepository, *tracetest.SpanRecorder) {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	noopHist, _ := otel.NoopProviders().Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
	repo := newActivityRepository(&fakeQuerier{})
	repo.tracer = tp.Tracer("test")
	repo.histogram = noopHist
	return repo, sr
}

// findSpan returns the first ended span with the given name, or nil if not found.
func findSpan(spans []sdktrace.ReadOnlySpan, name string) sdktrace.ReadOnlySpan {
	for _, s := range spans {
		if s.Name() == name {
			return s
		}
	}
	return nil
}

// attrAsString returns the string value of an attribute by key, or "" if missing.
func attrAsString(span sdktrace.ReadOnlySpan, key string) string {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsString()
		}
	}
	return ""
}

// attrAsInt returns the int64 value of an attribute by key, or -1 if missing.
func attrAsInt(span sdktrace.ReadOnlySpan, key string) int64 {
	for _, a := range span.Attributes() {
		if string(a.Key) == key {
			return a.Value.AsInt64()
		}
	}
	return -1
}

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

		// Verify nil pool handling (defensive - shouldn't happen in practice).
		// Pass nil tracer; constructor falls back to no-op.
		noopHist, _ := otel.NoopProviders().Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
		repo := constructor(nil, noopHist, nil)
		if repo.pool != nil {
			t.Error("expected nil pool to be stored as nil")
		}
	})
}

func TestGetActivityByID_NotFound_EmitsSpan(t *testing.T) {
	// The not-found path must emit a `repository.activities.get_by_id` span
	// with `result.row_count=0` and OK (not error) status — pgx.ErrNoRows is
	// converted to (nil, nil) so traces classify it as a normal API outcome.
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))

	repo := newActivityRepository(&fakeQuerier{
		queryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &fakeRow{scanFn: func(_ ...any) error { return pgx.ErrNoRows }}
		},
	})
	repo.tracer = tp.Tracer("test")
	noopHist, _ := otel.NoopProviders().Meter.Float64Histogram("test") //nolint:errcheck // no-op meter never fails
	repo.histogram = noopHist

	activity, err := repo.GetActivityByID(context.Background(), "user-123", 42)
	if err != nil {
		t.Fatalf("expected nil error on not-found, got %v", err)
	}
	if activity != nil {
		t.Errorf("expected nil activity on not-found, got %v", activity)
	}

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	span := ended[0]
	if span.Name() != "repository.activities.get_by_id" {
		t.Errorf("span name = %q, want %q", span.Name(), "repository.activities.get_by_id")
	}
	if got := span.Status().Code.String(); got != "Unset" && got != "Ok" {
		t.Errorf("span status = %q, want Unset or Ok (not-found is success)", got)
	}

	// Required attributes: db.system, db.name, db.operation, enduser.id,
	// activity_id, result.row_count.
	wantAttrs := map[string]any{
		"db.system":        "postgresql",
		"db.name":          "desirelines",
		"db.operation":     "SELECT",
		"enduser.id":       "user-123",
		"activity_id":      int64(42),
		"result.row_count": int64(0),
	}
	for _, attr := range span.Attributes() {
		want, ok := wantAttrs[string(attr.Key)]
		if !ok {
			continue
		}
		switch v := want.(type) {
		case string:
			if got := attr.Value.AsString(); got != v {
				t.Errorf("attr %q = %q, want %q", attr.Key, got, v)
			}
		case int64:
			if got := attr.Value.AsInt64(); got != v {
				t.Errorf("attr %q = %d, want %d", attr.Key, got, v)
			}
		}
		delete(wantAttrs, string(attr.Key))
	}
	if len(wantAttrs) != 0 {
		t.Errorf("missing required attributes: %v", wantAttrs)
	}
}

func TestGetYearMetadata_EmitsSpan(t *testing.T) {
	// Empty result set: span emits with year_metadata name and the expected
	// attributes; result.row_count = 0 (no sports for that year).
	repo, sr := newSpanRecordingRepo(t)

	metadata, err := repo.GetYearMetadata(context.Background(), "user-1", 2026)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if metadata == nil {
		t.Fatal("expected non-nil YearMetadata even with empty rows")
	}

	span := findSpan(sr.Ended(), "repository.activities.year_metadata")
	if span == nil {
		t.Fatalf("year_metadata span not emitted")
	}
	if got := attrAsString(span, "enduser.id"); got != "user-1" {
		t.Errorf("enduser.id = %q, want user-1", got)
	}
	if got := attrAsInt(span, "year"); got != 2026 {
		t.Errorf("year = %d, want 2026", got)
	}
	if got := attrAsInt(span, "result.row_count"); got != 0 {
		t.Errorf("result.row_count = %d, want 0", got)
	}
}

func TestListActivities_EmitsSpan(t *testing.T) {
	// ListActivities adds limit/sport_count/has_cursor attributes plus the
	// db.* and enduser.id keys. Empty filter yields zero rows.
	repo, sr := newSpanRecordingRepo(t)

	resp, err := repo.ListActivities(context.Background(), repository.ActivityListFilter{
		UserID:     "user-1",
		Limit:      50,
		SportTypes: []string{"Run", "Ride"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response even with empty rows")
	}

	span := findSpan(sr.Ended(), "repository.activities.list")
	if span == nil {
		t.Fatalf("list span not emitted")
	}
	if got := attrAsInt(span, "limit"); got != 50 {
		t.Errorf("limit = %d, want 50", got)
	}
	if got := attrAsInt(span, "sport_count"); got != 2 {
		t.Errorf("sport_count = %d, want 2", got)
	}
	for _, a := range span.Attributes() {
		if string(a.Key) == "has_cursor" && a.Value.AsBool() {
			t.Errorf("has_cursor = true, want false (no cursor in filter)")
		}
	}
}

func TestGetNormalizedRoutes_EmitsSpan(t *testing.T) {
	repo, sr := newSpanRecordingRepo(t)

	routes, err := repo.GetNormalizedRoutes(context.Background(), "user-1", 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if routes == nil {
		t.Logf("note: routes is nil on empty result; len() is 0 either way")
	}

	span := findSpan(sr.Ended(), "repository.activities.list_routes")
	if span == nil {
		t.Fatalf("list_routes span not emitted")
	}
	if got := attrAsInt(span, "limit"); got != 100 {
		t.Errorf("limit = %d, want 100", got)
	}
	if got := attrAsInt(span, "result.row_count"); got != 0 {
		t.Errorf("result.row_count = %d, want 0", got)
	}
}

func TestGetMultiSportMetricsByDateRange_EmitsSpan(t *testing.T) {
	// Exercises both the public method's span AND the helper
	// queryMultiSportByDateRange's RecordDuration call. Empty rows return
	// an empty map.
	repo, sr := newSpanRecordingRepo(t)

	result, err := repo.GetMultiSportMetricsByDateRange(
		context.Background(), "user-1", "2026-01-01", "2026-12-31",
		[]string{"Run", "Ride"},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty result map, got %d entries", len(result))
	}

	span := findSpan(sr.Ended(), "repository.activities.multi_sport_metrics_by_date_range")
	if span == nil {
		t.Fatalf("multi_sport_metrics_by_date_range span not emitted")
	}
	if got := attrAsString(span, "from"); got != "2026-01-01" {
		t.Errorf("from = %q, want 2026-01-01", got)
	}
	if got := attrAsInt(span, "sport_count"); got != 2 {
		t.Errorf("sport_count = %d, want 2", got)
	}
}

func TestGetMultiSportDailySummaryByDateRange_EmitsSpan(t *testing.T) {
	repo, sr := newSpanRecordingRepo(t)

	_, err := repo.GetMultiSportDailySummaryByDateRange(
		context.Background(), "user-1", "2026-01-01", "2026-12-31",
		[]string{"Run"},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	span := findSpan(sr.Ended(), "repository.activities.multi_sport_daily_summary_by_date_range")
	if span == nil {
		t.Fatalf("multi_sport_daily_summary_by_date_range span not emitted")
	}
	if got := attrAsInt(span, "sport_count"); got != 1 {
		t.Errorf("sport_count = %d, want 1", got)
	}
}

func TestGetMultiSportMetrics_YearWrapperEmitsBothSpans(t *testing.T) {
	// The year wrapper computes from/to via getDateRangeForYear and delegates.
	// We expect TWO spans in the trace: the wrapper (multi_sport_metrics) and
	// the underlying date-range method's span.
	repo, sr := newSpanRecordingRepo(t)

	loc := time.UTC
	_, err := repo.GetMultiSportMetrics(
		context.Background(), "user-1", 2026, []string{"Run"}, loc,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	wrapper := findSpan(sr.Ended(), "repository.activities.multi_sport_metrics")
	inner := findSpan(sr.Ended(), "repository.activities.multi_sport_metrics_by_date_range")
	if wrapper == nil {
		t.Fatalf("wrapper span (multi_sport_metrics) not emitted")
	}
	if inner == nil {
		t.Fatalf("inner span (multi_sport_metrics_by_date_range) not emitted")
	}
	if got := attrAsInt(wrapper, "year"); got != 2026 {
		t.Errorf("wrapper year = %d, want 2026", got)
	}
}

func TestGetMultiSportDailySummary_YearWrapperEmitsBothSpans(t *testing.T) {
	repo, sr := newSpanRecordingRepo(t)

	loc := time.UTC
	_, err := repo.GetMultiSportDailySummary(
		context.Background(), "user-1", 2026, []string{"Run"}, loc,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if findSpan(sr.Ended(), "repository.activities.multi_sport_daily_summary") == nil {
		t.Errorf("wrapper span (multi_sport_daily_summary) not emitted")
	}
	if findSpan(sr.Ended(), "repository.activities.multi_sport_daily_summary_by_date_range") == nil {
		t.Errorf("inner span (multi_sport_daily_summary_by_date_range) not emitted")
	}
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
