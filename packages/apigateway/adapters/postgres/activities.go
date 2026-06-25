// Package postgres provides PostgreSQL adapters for the repository interfaces.
// This is the infrastructure layer in hexagonal architecture, implementing
// the ports defined in the repository package.
//
// Components:
//   - Pool: Connection pool wrapper with serverless-optimized settings
//   - ActivityRepository: Implements repository.ActivityRepository for activities data
//
// The package uses pgx/v5 for PostgreSQL connectivity and provides:
//   - Multi-sport cumulative metrics (GetMultiSportMetrics, GetMultiSportMetricsByDateRange)
//   - Multi-sport daily summaries (GetMultiSportDailySummary, GetMultiSportDailySummaryByDateRange)
//   - Activity CRUD operations (GetActivityByID, ListActivities)
//   - Year metadata aggregation (GetYearMetadata)
//
// All queries use parameterized statements to prevent SQL injection.
//
// # Schema Names
//
// Queries explicitly use "desirelines.activities" rather than relying on search_path.
// This is intentional: explicit schema names are self-documenting, work regardless of
// connection configuration, and prevent accidental queries to wrong schemas.
//
// # Column Mapping (Strava → DB)
//
// Strava's API has two activity classification fields that are easy to confuse:
//   - type: broad/deprecated category (e.g., "Workout" covers yoga, weights, HIIT, etc.)
//   - sport_type: specific activity kind (e.g., "Yoga", "WeightTraining", "HIIT")
//
// The DB maps these to:
//   - 'type' column  ← Strava 'type' field     (broad, rarely used for filtering)
//   - 'sport' column ← Strava 'sport_type' field (specific, used for all filtering)
//
// sport_types.json config contains sport_type values. All WHERE clauses that filter
// by sport must use `sport = ANY(...)`, never `type = ANY(...)`.
//
// # Timezone Handling
//
// The start_date_local column is a TIMESTAMP (without timezone) containing the
// activity start time in the athlete's local timezone, exactly as Strava provides.
// Queries use start_date_local::date to extract dates, which is correct because:
//
//   - It returns the date the user experienced the activity (e.g., "Jan 15" for a
//     late-night run in Tokyo stays "Jan 15", not "Jan 14" as UTC would show)
//   - TIMESTAMP (without timezone) is not affected by PostgreSQL session timezone
//   - No UTC conversion should occur - that would misrepresent the user's experience
//
// This is intentional and correct for the Strava data model where activities are
// meaningfully grouped by the user's local date, not a global timestamp.
package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

// Span attribute conventions used across this adapter. Constants so the
// strings are stable and grep-able when tuning SLO labels later.
const (
	dbSystem   = "postgresql"
	dbName     = "desirelines"
	dbOpSelect = "SELECT"
)

// AggregationVersion is the version string for the data aggregation schema.
// Increment when the aggregation logic or data format changes.
const AggregationVersion = "2.0"

// ActivityRepository implements repository.ActivityRepository for PostgreSQL.
// This is an adapter in hexagonal architecture - infrastructure layer.
//
// The db field satisfies DBQuerier and is used for all query execution.
// In production, db and pool both point to the connection pool.
// In tests, db may be a transaction (for rollback isolation) while pool is nil.
type ActivityRepository struct {
	db        DBQuerier
	pool      *Pool
	histogram metric.Float64Histogram
	tracer    trace.Tracer
}

// Compile-time interface verification
var _ repository.ActivityRepository = (*ActivityRepository)(nil)

// NewActivityRepository creates a PostgreSQL activity repository.
//
// The tracer is used to emit per-method spans (`repository.activities.*`)
// so trace inspection can attribute apigateway latency to specific queries
// rather than seeing a single flat handler span. Pass a noop tracer when
// instrumentation isn't desired (e.g. tests); the production wiring in
// cmd/apigateway/main.go threads in providers.Tracer.
func NewActivityRepository(pool *Pool, histogram metric.Float64Histogram, tracer trace.Tracer) *ActivityRepository {
	if tracer == nil {
		tracer = tracenoop.NewTracerProvider().Tracer("")
	}
	return &ActivityRepository{db: pool, pool: pool, histogram: histogram, tracer: tracer}
}

// newActivityRepository creates a repository backed by any DBQuerier.
// Used in tests to inject a transaction for rollback isolation.
func newActivityRepository(db DBQuerier) *ActivityRepository {
	return &ActivityRepository{db: db, tracer: tracenoop.NewTracerProvider().Tracer("")}
}

// Ping verifies database connectivity.
func (r *ActivityRepository) Ping(ctx context.Context) error {
	if r.pool != nil {
		if err := r.pool.Ping(ctx); err != nil {
			return fmt.Errorf("postgres ping: %w", err)
		}
		return nil
	}
	if _, err := r.db.Exec(ctx, "SELECT 1"); err != nil {
		return fmt.Errorf("postgres ping exec: %w", err)
	}
	return nil
}

// Close releases all database resources.
// No-op when pool is nil (test mode with transaction).
func (r *ActivityRepository) Close() error {
	if r.pool != nil {
		r.pool.Close()
	}
	return nil
}

// queryMultiSportByDateRange is a helper that executes a multi-sport query with a date range
// and wraps errors. It deliberately does NOT record the query-duration histogram: that timer
// must outlive the caller's row-scan loop (where a full-year × multi-sport result spends most
// of its latency), so each caller owns RecordDuration at method scope — like the other
// repository methods — rather than having it fire here, immediately after Query() returns.
func (r *ActivityRepository) queryMultiSportByDateRange(ctx context.Context, op, query, userID, from, to string, sportTypes []string) (pgx.Rows, error) {
	rows, err := r.db.Query(ctx, query, userID, from, to, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query multi-sport %s: %w", op, err)
	}
	return rows, nil
}

// GetMultiSportMetricsByDateRange returns cumulative metrics for multiple sports in a date range.
// Each sport gets its own dense date series via CROSS JOIN with unnest of the sport types parameter,
// ensuring correct cumulative sums even for sports with no activity data in the range.
//
//nolint:dupl // Span-attribute list intentionally mirrors sibling multi-sport methods so each retains its own grep-able span name and attribute set; extracting a helper would obscure that.
func (r *ActivityRepository) GetMultiSportMetricsByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (result map[string]*generated.SportMetrics, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.multi_sport_metrics_by_date_range",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.String("from", from),
		attribute.String("to", to),
		attribute.Int("sport_count", len(sportTypes)),
	)
	// operation= label aligned with span name; timed at method scope so the histogram spans
	// the row-scan loop (queryMultiSportByDateRange deliberately does not own this timer).
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "multi_sport_metrics_by_date_range"))
	defer func() {
		// result.row_count = number of sports returned (each may have many timeseries points).
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(result)))
		done(retErr)
		spanDone(retErr)
	}()

	query := `
		SELECT
			sport,
			date,
			SUM(distance) OVER (PARTITION BY sport ORDER BY date) as distance,
			SUM(elevation) OVER (PARTITION BY sport ORDER BY date) as elevation,
			SUM(time) OVER (PARTITION BY sport ORDER BY date) as time,
			SUM(activities) OVER (PARTITION BY sport ORDER BY date)::int as activities
		FROM (
			SELECT
				sports.sport,
				all_dates.date,
				COALESCE(daily.distance, 0) as distance,
				COALESCE(daily.elevation, 0) as elevation,
				COALESCE(daily.time, 0) as time,
				COALESCE(daily.activities, 0) as activities
			FROM (
				SELECT generate_series($2::date, $3::date, '1 day'::interval)::date as date
			) all_dates
			CROSS JOIN (
				SELECT unnest($4::text[]) AS sport
			) sports
			LEFT JOIN (
				SELECT
					sport,
					start_date_local::date as date,
					SUM(distance) as distance,
					SUM(total_elevation_gain) as elevation,
					SUM(moving_time) / 60.0 as time,
					COUNT(*) as activities
				FROM desirelines.activities
				WHERE user_id = $1
				  AND start_date_local::date >= $2::date
				  AND start_date_local::date <= $3::date
				  AND sport = ANY($4)
				GROUP BY sport, start_date_local::date
			) daily ON all_dates.date = daily.date AND sports.sport = daily.sport
		) dense_daily
		ORDER BY sport, date ASC
	`

	rows, err := r.queryMultiSportByDateRange(ctx, "multi_sport_metrics_by_date_range", query, userID, from, to, sportTypes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanMultiSportMetricsRows(rows)
}

// getDateRangeForYear calculates the from and to date strings for a given year,
// capping the 'to' date at today if it's the current year. Using the user's timezone
// prevents the range from extending into "tomorrow" when the server runs in UTC.
func getDateRangeForYear(year int, loc *time.Location) (from, to string) {
	from = fmt.Sprintf("%d-01-01", year)
	to = fmt.Sprintf("%d-12-31", year)

	now := time.Now().In(loc)
	if year == now.Year() {
		to = now.Format("2006-01-02")
	}
	return from, to
}

// GetMultiSportMetrics returns cumulative metrics for multiple sports in a given year.
// Each sport gets its own dense date series via CROSS JOIN with unnest of the sport types parameter.
// loc determines "today" for current-year queries — using the user's timezone prevents
// the dense series from extending into "tomorrow" when the server runs in UTC.
//
// Pure delegation: the wrapper computes from/to and delegates to the
// date-range method. Doesn't open its own span (would just be a thin parent
// of the inner span — noise). Stamps `year` on the active server span so
// trace consumers can still filter "metrics for year=X" without losing the
// information when delegating.
func (r *ActivityRepository) GetMultiSportMetrics(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.SportMetrics, error) {
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(attribute.Int("year", year))
	}
	from, to := getDateRangeForYear(year, loc)
	return r.GetMultiSportMetricsByDateRange(ctx, userID, from, to, sportTypes)
}

// scanMultiSportMetricsRows scans database rows into a map of sport → SportMetrics.
// Shared by both GetMultiSportMetrics and GetMultiSportMetricsByDateRange.
func scanMultiSportMetricsRows(rows rowScanner) (map[string]*generated.SportMetrics, error) {
	result := make(map[string]*generated.SportMetrics)
	for rows.Next() {
		var sport string
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int32

		if scanErr := rows.Scan(&sport, &date, &distance, &elevation, &timeMinutes, &activities); scanErr != nil {
			return nil, fmt.Errorf("scan multi-sport metrics row: %w", scanErr)
		}

		if _, ok := result[sport]; !ok {
			result[sport] = &generated.SportMetrics{
				Timeseries: make([]*generated.CumulativeMetricsEntry, 0),
			}
		}

		entry := &generated.CumulativeMetricsEntry{
			Date:       date.Format("2006-01-02"),
			Distance:   &distance,
			Elevation:  &elevation,
			Time:       &timeMinutes,
			Activities: &activities,
		}
		result[sport].Timeseries = append(result[sport].Timeseries, entry)
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate multi-sport metrics rows: %w", rowsErr)
	}

	return result, nil
}

// GetMultiSportDailySummary returns daily summaries for multiple sports in a given year.
// Returns a map keyed by raw Strava sport type.
//
// Pure delegation; see GetMultiSportMetrics for the year-wrapper rationale.
func (r *ActivityRepository) GetMultiSportDailySummary(ctx context.Context, userID string, year int, sportTypes []string, loc *time.Location) (map[string]*generated.DailySummary, error) {
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(attribute.Int("year", year))
	}
	from, to := getDateRangeForYear(year, loc)
	return r.GetMultiSportDailySummaryByDateRange(ctx, userID, from, to, sportTypes)
}

// GetMultiSportDailySummaryByDateRange returns daily summaries for multiple sports in a date range.
// Returns a map keyed by raw Strava sport type.
//
//nolint:dupl // Span-attribute list intentionally mirrors sibling multi-sport methods so each retains its own grep-able span name and attribute set.
func (r *ActivityRepository) GetMultiSportDailySummaryByDateRange(ctx context.Context, userID, from, to string, sportTypes []string) (result map[string]*generated.DailySummary, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.multi_sport_daily_summary_by_date_range",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.String("from", from),
		attribute.String("to", to),
		attribute.Int("sport_count", len(sportTypes)),
	)
	// operation= label aligned with span name; timed at method scope so the histogram spans
	// the row-scan loop (queryMultiSportByDateRange deliberately does not own this timer).
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "multi_sport_daily_summary_by_date_range"))
	defer func() {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(result)))
		done(retErr)
		spanDone(retErr)
	}()

	query := `
		SELECT
			sport,
			start_date_local::date as date,
			SUM(distance) as distance,
			SUM(total_elevation_gain) as elevation,
			SUM(moving_time) / 60.0 as time,
			COUNT(*) as activities,
			array_agg(id ORDER BY id) as activity_ids
		FROM desirelines.activities
		WHERE user_id = $1
		  AND start_date_local::date >= $2::date
		  AND start_date_local::date <= $3::date
		  AND sport = ANY($4)
		GROUP BY sport, start_date_local::date
		ORDER BY sport, start_date_local::date ASC
	`

	rows, err := r.queryMultiSportByDateRange(ctx, "multi_sport_daily_summary_by_date_range", query, userID, from, to, sportTypes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanMultiSportDailySummaryRows(rows)
}

// scanMultiSportDailySummaryRows scans database rows into a map of sport → DailySummary.
// Shared by both GetMultiSportDailySummary and GetMultiSportDailySummaryByDateRange.
func scanMultiSportDailySummaryRows(rows rowScanner) (map[string]*generated.DailySummary, error) {
	result := make(map[string]*generated.DailySummary)
	for rows.Next() {
		var sport string
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int32
		var activityIDs []int64

		if scanErr := rows.Scan(&sport, &date, &distance, &elevation, &timeMinutes, &activities, &activityIDs); scanErr != nil {
			return nil, fmt.Errorf("scan multi-sport daily summary row: %w", scanErr)
		}

		if _, ok := result[sport]; !ok {
			result[sport] = &generated.DailySummary{
				Daily: make(map[string]*generated.DailyActivity),
			}
		}

		dateStr := date.Format("2006-01-02")
		result[sport].Daily[dateStr] = &generated.DailyActivity{
			DistanceMeters:  &distance,
			ElevationMeters: &elevation,
			TimeMinutes:     &timeMinutes,
			Activities:      activities,
			ActivityIds:     activityIDs,
		}
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate multi-sport daily summary rows: %w", rowsErr)
	}

	return result, nil
}

// GetYearMetadata returns metadata about activities for a given year.
// Includes list of sports, per-sport totals, and last updated timestamp.
func (r *ActivityRepository) GetYearMetadata(ctx context.Context, userID string, year int) (metadata *generated.YearMetadata, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.year_metadata",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.Int("year", year),
	)
	// operation= label aligned with span name `repository.activities.year_metadata`.
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "year_metadata"))
	defer func() {
		// row_count = number of distinct sports the user had in this year.
		if metadata != nil {
			trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(metadata.Sports)))
		}
		done(retErr)
		spanDone(retErr)
	}()
	// Validate year range early to avoid unnecessary DB query and satisfy G115 (int to int32)
	if year < 0 || year > math.MaxInt32 {
		return nil, fmt.Errorf("year %d out of valid range (0-%d)", year, math.MaxInt32)
	}
	yearInt32 := int32(year)

	query := `
		SELECT
			sport,
			SUM(distance) as distance,
			SUM(total_elevation_gain) as elevation,
			SUM(moving_time) / 60.0 as time,
			COUNT(*) as activities,
			MAX(updated_at) as last_updated
		FROM desirelines.activities
		WHERE user_id = $1
		  AND year = $2
		GROUP BY sport
		ORDER BY sport ASC
	`

	rows, retErr := r.db.Query(ctx, query, userID, year)
	if retErr != nil {
		return nil, fmt.Errorf("query year metadata: %w", retErr)
	}
	defer rows.Close()

	sports := make([]string, 0) // Initialize as empty slice, not nil (JSON: [] not null)
	totals := make(map[string]*generated.SportTotals)
	var latestUpdate *time.Time

	for rows.Next() {
		var sport string
		var distance, elevation, timeMinutes float64
		var activities int32
		var lastUpdated *time.Time

		if scanErr := rows.Scan(&sport, &distance, &elevation, &timeMinutes, &activities, &lastUpdated); scanErr != nil {
			retErr = scanErr
			return nil, fmt.Errorf("scan year metadata row: %w", scanErr)
		}

		sports = append(sports, sport)
		totals[sport] = &generated.SportTotals{
			DistanceMeters:  &distance,
			ElevationMeters: &elevation,
			TimeMinutes:     &timeMinutes,
			Activities:      activities,
		}

		// Track the most recent update across all sports
		if lastUpdated != nil && (latestUpdate == nil || lastUpdated.After(*latestUpdate)) {
			latestUpdate = lastUpdated
		}
	}

	if retErr = rows.Err(); retErr != nil {
		return nil, fmt.Errorf("iterate year metadata rows: %w", retErr)
	}

	// Convert time to ISO string for JSON response
	var lastUpdatedStr *string
	if latestUpdate != nil {
		s := latestUpdate.Format(time.RFC3339)
		lastUpdatedStr = &s
	}

	return &generated.YearMetadata{
		Year:               yearInt32,
		Sports:             sports,
		Totals:             totals,
		LastUpdated:        lastUpdatedStr,
		AggregationVersion: AggregationVersion,
	}, nil
}

// GetActivityByID returns a single activity by its Strava ID.
// Returns nil (not error) if the activity is not found.
func (r *ActivityRepository) GetActivityByID(ctx context.Context, userID string, id int64) (activity *activitiesv1.Activity, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.get_by_id",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.Int64("activity_id", id),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "get_by_id"))
	defer func() {
		// 0 if not found (treated as success), 1 if a row was returned.
		rowCount := 0
		if activity != nil {
			rowCount = 1
		}
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", rowCount))
		done(retErr)
		spanDone(retErr)
	}()
	query := `
		SELECT
			id, name, type, sport, start_date_local,
			distance, moving_time, elapsed_time,
			total_elevation_gain, average_speed, max_speed,
			average_heartrate, max_heartrate
		FROM desirelines.activities
		WHERE user_id = $1 AND id = $2
	`

	row := r.db.QueryRow(ctx, query, userID, id)

	var activityID int64
	var name, activityType, sport string
	var startDateLocal time.Time
	var distanceMeters float64
	var movingTime, elapsedTime int32
	var elevation, avgSpeed, maxSpeed, avgHR, maxHR *float64

	retErr = row.Scan(
		&activityID,
		&name,
		&activityType,
		&sport,
		&startDateLocal,
		&distanceMeters,
		&movingTime,
		&elapsedTime,
		&elevation,
		&avgSpeed,
		&maxSpeed,
		&avgHR,
		&maxHR,
	)

	if retErr != nil {
		// Check for not found - pgx returns specific error.
		// Clear retErr so the duration metric and span both record this as
		// success, not error: a missing activity is a normal API response.
		if errors.Is(retErr, pgx.ErrNoRows) {
			retErr = nil
			return nil, nil
		}
		return nil, fmt.Errorf("query activity by id: %w", retErr)
	}

	return &activitiesv1.Activity{
		Id:                 activityID,
		Name:               name,
		Type:               activityType,
		Sport:              sport,
		StartDateLocal:     startDateLocal.Format(time.RFC3339),
		DistanceMeters:     distanceMeters,
		MovingTimeSeconds:  movingTime,
		ElapsedTimeSeconds: elapsedTime,
		ElevationMeters:    elevation,
		AverageSpeedMps:    avgSpeed,
		MaxSpeedMps:        maxSpeed,
		AverageHeartrate:   avgHR,
		MaxHeartrate:       maxHR,
	}, nil
}

// queryBuilder helps construct parameterized SQL queries safely.
// It automatically manages argument numbering to prevent off-by-one errors.
type queryBuilder struct {
	query  string
	args   []interface{}
	argNum int
}

// newQueryBuilder creates a query builder with the base query.
func newQueryBuilder(baseQuery string) *queryBuilder {
	return &queryBuilder{
		query:  baseQuery,
		args:   make([]interface{}, 0),
		argNum: 1,
	}
}

// AddCondition appends a WHERE condition with variable parameters.
// It validates that the number of %d placeholders matches the number of arguments.
// It automatically injects the correct argument numbers ($1, $2, etc.).
func (qb *queryBuilder) AddCondition(format string, args ...interface{}) {
	// Validate placeholder count
	// Count %d placeholders, ignoring escaped %% (which become empty string)
	placeholders := strings.Count(strings.ReplaceAll(format, "%%", ""), "%d")

	if placeholders != len(args) {
		//nolint:forbidigo // programmer-error guard — a mismatch here means a caller built a malformed query; fail fast rather than return an error that can't be meaningfully handled at runtime
		panic(fmt.Sprintf("queryBuilder: format %q has %d placeholders but %d args", format, placeholders, len(args)))
	}

	// Generate argument indices for Sprintf
	indices := make([]interface{}, len(args))
	for i := range indices {
		indices[i] = qb.argNum + i
	}

	qb.query += fmt.Sprintf(format, indices...)
	qb.args = append(qb.args, args...)
	qb.argNum += len(args)
}

// append adds a literal string to the query (no parameters).
func (qb *queryBuilder) append(s string) {
	qb.query += s
}

// ListActivities returns activities matching the filter criteria with cursor-based pagination.
// Results are ordered by (start_date_local DESC, id DESC) for stable ordering.
// Uses keyset pagination for O(1) performance regardless of offset.
//
//nolint:gocyclo // Complexity is from query-builder branching on optional filter fields; not worth restructuring just to drop one over the threshold.
func (r *ActivityRepository) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (resp *activitiesv1.ListActivitiesResponse, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.list",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", filter.UserID),
		attribute.Int("limit", filter.Limit),
		attribute.Int("sport_count", len(filter.SportTypes)),
		attribute.Bool("has_cursor", filter.Cursor != nil),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "list"))
	defer func() {
		if resp != nil {
			trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(resp.Activities)))
		}
		done(retErr)
		spanDone(retErr)
	}()
	// Build query dynamically based on filter
	// We fetch limit+1 to determine if there are more results
	qb := newQueryBuilder(`
		SELECT
			id, name, type, sport, start_date_local,
			distance, moving_time, total_elevation_gain
		FROM desirelines.activities
		WHERE 1=1
	`)

	// Filter by user ID (required for query isolation)
	qb.AddCondition(" AND user_id = $%d", filter.UserID)

	// Add date range filters
	if filter.From != nil {
		qb.AddCondition(" AND start_date_local >= $%d::date", *filter.From)
	}

	if filter.To != nil {
		// Add 1 day to make 'to' inclusive (end of day)
		qb.AddCondition(" AND start_date_local < ($%d::date + interval '1 day')", *filter.To)
	}

	// Add sport filter (filter on 'sport' column which contains Strava sport_type values)
	if len(filter.SportTypes) > 0 {
		qb.AddCondition(" AND sport = ANY($%d)", filter.SportTypes)
	}

	// Add cursor constraint for pagination
	if filter.Cursor != nil {
		// Keyset pagination: get rows where (start_date_local, id) < (cursor.timestamp, cursor.id)
		// This works because we order by start_date_local DESC, id DESC
		qb.AddCondition(" AND (start_date_local, id) < ($%d::timestamp, $%d)", filter.Cursor.Timestamp, filter.Cursor.ID)
	}

	// Order by for stable pagination
	qb.append(" ORDER BY start_date_local DESC, id DESC")

	// Limit (+1 to detect if there are more results)
	limit := filter.Limit
	if limit <= 0 {
		limit = repository.DefaultListLimit
	}
	if limit > repository.MaxListLimit {
		limit = repository.MaxListLimit
	}
	qb.AddCondition(" LIMIT $%d", limit+1)

	rows, retErr := r.db.Query(ctx, qb.query, qb.args...)
	if retErr != nil {
		return nil, fmt.Errorf("query activities list: %w", retErr)
	}
	defer rows.Close()

	// Internal struct for scanning rows before building proto messages
	type scannedActivity struct {
		id             int64
		name           string
		activityType   string
		sport          string
		startDateLocal string
		distanceMeters float64
		movingTime     int32
		elevation      *float64
	}

	scannedActivities := make([]scannedActivity, 0, limit)
	for rows.Next() {
		var id int64
		var name, activityType, sport string
		var startDateLocal time.Time
		var distanceMeters float64
		var movingTime int32
		var elevation *float64

		if retErr = rows.Scan(
			&id,
			&name,
			&activityType,
			&sport,
			&startDateLocal,
			&distanceMeters,
			&movingTime,
			&elevation,
		); retErr != nil {
			return nil, fmt.Errorf("scan activity row: %w", retErr)
		}

		scannedActivities = append(scannedActivities, scannedActivity{
			id:             id,
			name:           name,
			activityType:   activityType,
			sport:          sport,
			startDateLocal: startDateLocal.Format(time.RFC3339),
			distanceMeters: distanceMeters,
			movingTime:     movingTime,
			elevation:      elevation,
		})
	}

	if retErr = rows.Err(); retErr != nil {
		return nil, fmt.Errorf("iterate activities rows: %w", retErr)
	}

	// Determine if there are more results
	hasMore := len(scannedActivities) > limit
	if hasMore {
		// Remove the extra row we fetched
		scannedActivities = scannedActivities[:limit]
	}

	// Build proto messages
	activities := make([]*activitiesv1.ActivitySummary, 0, len(scannedActivities))
	for _, a := range scannedActivities {
		activities = append(activities, &activitiesv1.ActivitySummary{
			Id:                a.id,
			Name:              a.name,
			Type:              a.activityType,
			Sport:             a.sport,
			StartDateLocal:    a.startDateLocal,
			DistanceMeters:    a.distanceMeters,
			MovingTimeSeconds: a.movingTime,
			ElevationMeters:   a.elevation,
		})
	}

	// Build next cursor from last activity
	var nextCursor *string
	if hasMore && len(scannedActivities) > 0 {
		lastActivity := scannedActivities[len(scannedActivities)-1]
		cursor := repository.ActivityCursor{
			Timestamp: lastActivity.startDateLocal,
			ID:        lastActivity.id,
		}
		encoded := encodeCursor(&cursor)
		nextCursor = &encoded
	}

	return &activitiesv1.ListActivitiesResponse{
		Activities: activities,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// GetNormalizedRoutes returns activity routes with coordinates centered at (0,0).
// Uses ST_Translate to center each route's start point at the origin, and
// ST_Simplify to reduce coordinate density for efficient frontend rendering.
func (r *ActivityRepository) GetNormalizedRoutes(ctx context.Context, userID string, limit int) (routes []repository.NormalizedRoute, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.list_routes",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.Int("limit", limit),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "list_routes"))
	defer func() {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(routes)))
		done(retErr)
		spanDone(retErr)
	}()

	// Match ListActivities pattern: default for unset, cap at max otherwise.
	if limit <= 0 {
		limit = repository.DefaultRoutesLimit
	}
	if limit > repository.MaxRoutesLimit {
		limit = repository.MaxRoutesLimit
	}

	query := `
		SELECT
			a.id,
			a.name,
			a.sport,
			a.distance,
			a.start_date_local::date,
			ST_AsGeoJSON(
				ST_Simplify(
					ST_Translate(ar.route,
						-ST_X(ST_StartPoint(ar.route)),
						-ST_Y(ST_StartPoint(ar.route))),
					0.0001)
			)::jsonb -> 'coordinates' AS coords
		FROM desirelines.activity_routes ar
		JOIN desirelines.activities a ON a.id = ar.activity_id
		WHERE a.user_id = $1
		ORDER BY a.start_date_local DESC
		LIMIT $2
	`

	rows, retErr := r.db.Query(ctx, query, userID, limit)
	if retErr != nil {
		return nil, fmt.Errorf("query normalized routes: %w", retErr)
	}
	defer rows.Close()

	routes = make([]repository.NormalizedRoute, 0, limit)
	for rows.Next() {
		var route repository.NormalizedRoute
		var date time.Time
		var coordsJSON []byte

		if retErr = rows.Scan(&route.ActivityID, &route.Name, &route.Sport, &route.Distance, &date, &coordsJSON); retErr != nil {
			return nil, fmt.Errorf("scan normalized route row: %w", retErr)
		}

		route.Date = date.Format("2006-01-02")

		if retErr = json.Unmarshal(coordsJSON, &route.Coords); retErr != nil {
			return nil, fmt.Errorf("unmarshal route coords for activity %d: %w", route.ActivityID, retErr)
		}

		routes = append(routes, route)
	}

	if retErr = rows.Err(); retErr != nil {
		return nil, fmt.Errorf("iterate normalized route rows: %w", retErr)
	}

	return routes, nil
}

// lineMinZoom is the level-of-detail handoff for the MVT tile endpoint. At
// z >= lineMinZoom a tile carries simplified route *lines* (`routes` layer); below
// it a tile carries grid-binned density *points* (`route_points` layer) instead —
// thousands of overlapping full-resolution GPS lines at low zoom are slow to encode
// and read as noise. The web client mirrors this with layer min/maxzoom at the same
// value (RouteMap.tsx) — keep the two in sync.
const lineMinZoom = 8

// routeTileLinesQuery builds the `routes` line layer for z >= lineMinZoom. It adds
// zoom-scaled ST_Simplify (was missing): tolerance ≈ a couple of MVT units in 3857
// meters — (worldMeters / 2^z) / 4096 * 1.5 — which is tens of meters at low zoom
// (real thinning of dense GPS tracks) and sub-meter by z14 (full fidelity at max
// zoom). $1=z $2=x $3=y $4=user_id. Filters on the raw 4326 column so the GIST index
// drives row selection (see GetRouteTile).
const routeTileLinesQuery = `
	WITH bounds AS (
		SELECT
			ST_TileEnvelope($1, $2, $3) AS env_3857,
			ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env_4326
	),
	mvtgeom AS (
		SELECT
			ST_AsMVTGeom(
				ST_Simplify(
					ST_Transform(ar.route, 3857),
					(40075016.6855785 / power(2.0, $1)) / 4096.0 * 1.5
				),
				bounds.env_3857
			) AS geom,
			a.id                            AS activity_id,
			a.name                          AS name,
			a.sport                         AS sport,
			a.distance                      AS distance,
			a.start_date_local::date::text  AS date
		FROM desirelines.activity_routes ar
		JOIN desirelines.activities a ON a.id = ar.activity_id
		CROSS JOIN bounds
		WHERE a.user_id = $4
		  AND ar.route && bounds.env_4326
		  AND ST_Intersects(ar.route, bounds.env_4326)
		  AND EXISTS (
			  SELECT 1 FROM desirelines.activity_regions arg
			  WHERE arg.activity_id = a.id
		  )
	)
	SELECT COALESCE(ST_AsMVT(t.*, 'routes'), ''::bytea)
	FROM mvtgeom t
	WHERE t.geom IS NOT NULL
`

// pointGridCell is the low-zoom binning grid size in MVT tile units. The tile extent
// is 4096, so the grid is (4096 / pointGridCell) cells per axis: smaller = finer
// geographic bins (and more dots/tile). Single source of truth — tune here. Started
// at 128 (32×32, too coarse geographically); 64 gives a 64×64 grid.
const pointGridCell = 64

// routeTilePointsQuery builds the `route_points` density layer for z < lineMinZoom.
// Each candidate activity's centroid is clipped into tile space and snapped to a
// (4096/pointGridCell)² grid. Bins are grouped by (cell, sport) — one dot **per
// sport** per cell — so a cell with 100 rides + 13 runs emits two dots at the same
// point; the client sizes each by its own `activity_count` and stacks them
// largest-behind (concentric, both visible). Output is bounded to
// ≤ (4096/pointGridCell)²×(#sports) points/tile. `sport` is the raw Strava sport_type
// (the client maps it to the app category color, same as the line layer). $1=z $2=x
// $3=y $4=user_id; same GIST-driven predicate as the lines query.
var routeTilePointsQuery = fmt.Sprintf(`
	WITH bounds AS (
		SELECT
			ST_TileEnvelope($1, $2, $3) AS env_3857,
			ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env_4326
	),
	pts AS (
		SELECT
			ST_AsMVTGeom(ST_Transform(ST_Centroid(ar.route), 3857), bounds.env_3857) AS geom,
			a.sport AS sport
		FROM desirelines.activity_routes ar
		JOIN desirelines.activities a ON a.id = ar.activity_id
		CROSS JOIN bounds
		WHERE a.user_id = $4
		  AND ar.route && bounds.env_4326
		  AND ST_Intersects(ar.route, bounds.env_4326)
		  AND EXISTS (
			  SELECT 1 FROM desirelines.activity_regions arg
			  WHERE arg.activity_id = a.id
		  )
	),
	bins AS (
		SELECT
			-- Snap to the CENTERS of a %[1]d-unit grid aligned to the tile: the 5-arg
			-- form (origin = half a cell %[2]d, size %[1]d) lands dots on true cell
			-- centers {%[2]d, %[2]d+%[1]d, ...} of tile-aligned cells [0,%[1]d),
			-- [%[1]d,2*%[1]d)... — all inside 0..4096, no half-bins, no ST_Translate.
			-- (ST_SnapToGrid rounds to nearest, so a plain 2-arg snap + translate would
			-- shift every dot a half-cell off-center and overshoot the tile edge.)
			ST_SnapToGrid(geom, %[2]d, %[2]d, %[1]d, %[1]d) AS geom,
			count(*)::int AS activity_count,
			sport
		FROM pts
		WHERE geom IS NOT NULL
		GROUP BY ST_SnapToGrid(geom, %[2]d, %[2]d, %[1]d, %[1]d), sport
	)
	SELECT COALESCE(ST_AsMVT(b.*, 'route_points'), ''::bytea)
	FROM bins b
`, pointGridCell, pointGridCell/2)

// GetRouteTile returns a Mapbox Vector Tile of the user's real-world activity routes
// for the z/x/y tile, with a level-of-detail switch at lineMinZoom: a simplified
// `routes` line layer at higher zoom, a grid-binned `route_points` density layer at
// low zoom (see those query consts). Geometry is reprojected to Web Mercator (3857)
// and clipped to the tile envelope with ST_AsMVTGeom. Only geo-bearing activities
// (>=1 activity_regions row) are included, excluding virtual/indoor activities. An
// empty tile is returned (not an error) when there are no features.
func (r *ActivityRepository) GetRouteTile(ctx context.Context, userID string, z, x, y int) (tile []byte, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.route_tile",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
		attribute.Int("tile.z", z),
		attribute.Int("tile.x", x),
		attribute.Int("tile.y", y),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "route_tile"))
	defer func() {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.tile_bytes", len(tile)))
		done(retErr)
		spanDone(retErr)
	}()

	// Filter on the raw 4326 column so the GIST index (idx_activity_routes_geom)
	// drives row selection: && uses the index, and ST_Intersects against the
	// transformed-back envelope keeps the exact test on the indexed geometry.
	// ST_Transform(route -> 3857) then runs only for the surviving rows, inside
	// ST_AsMVTGeom where the Web Mercator geometry is actually required.
	//
	// Level-of-detail switch: lines (simplified) at zoom >= lineMinZoom, grid-binned
	// density points below it. Both share the GIST-driven predicate above.
	query := routeTileLinesQuery
	mode := "lines"
	if z < lineMinZoom {
		query = routeTilePointsQuery
		mode = "points"
	}

	if retErr = r.db.QueryRow(ctx, query, z, x, y, userID).Scan(&tile); retErr != nil {
		return nil, fmt.Errorf("query route tile: %w", retErr)
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("tile.mode", mode))
	return tile, nil
}

// GetRouteRegionSummary returns each region the user has activities in, with the
// activity count and the region's bounding box, sorted densest-first. The client
// uses the top row to default the map viewport.
func (r *ActivityRepository) GetRouteRegionSummary(ctx context.Context, userID string) (summaries []repository.RegionSummary, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.route_region_summary",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "route_region_summary"))
	defer func() {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(summaries)))
		done(retErr)
		spanDone(retErr)
	}()

	const query = `
		SELECT
			re.id,
			re.region_name,
			re.region_kind,
			COUNT(DISTINCT ar.activity_id) AS activity_count,
			ST_XMin(ST_Extent(re.geom)) AS min_lng,
			ST_YMin(ST_Extent(re.geom)) AS min_lat,
			ST_XMax(ST_Extent(re.geom)) AS max_lng,
			ST_YMax(ST_Extent(re.geom)) AS max_lat
		FROM desirelines.activity_regions ar
		JOIN desirelines.activities a ON a.id = ar.activity_id
		JOIN desirelines.regions re ON re.id = ar.region_id
		WHERE a.user_id = $1
		GROUP BY re.id, re.region_name, re.region_kind
		ORDER BY activity_count DESC, re.region_name
	`

	rows, retErr := r.db.Query(ctx, query, userID)
	if retErr != nil {
		return nil, fmt.Errorf("query route region summary: %w", retErr)
	}
	defer rows.Close()

	summaries = make([]repository.RegionSummary, 0)
	for rows.Next() {
		var s repository.RegionSummary
		var minLng, minLat, maxLng, maxLat float64
		if retErr = rows.Scan(
			&s.RegionID, &s.Name, &s.Kind, &s.ActivityCount,
			&minLng, &minLat, &maxLng, &maxLat,
		); retErr != nil {
			return nil, fmt.Errorf("scan region summary row: %w", retErr)
		}
		s.BBox = [4]float64{minLng, minLat, maxLng, maxLat}
		summaries = append(summaries, s)
	}
	if retErr = rows.Err(); retErr != nil {
		return nil, fmt.Errorf("iterate region summary rows: %w", retErr)
	}
	return summaries, nil
}

// GetMapDataset returns every geo-bearing activity (>=1 activity_regions row)
// with scalars, its aggregated region tag ids, and an optional bounding box from
// its route geometry. Only activities that are tagged to at least one region are
// included (the JOIN to activity_regions enforces this), which excludes
// virtual/indoor activities — the same inclusion rule as GetRouteTile /
// GetRouteRegionSummary. The bbox is read from the activity's route geometry via
// the O(1) ST_X/Y Min/Max accessors (one route row per activity — activity_id is
// the activity_routes PK) and is NULL when there is no stored route geometry.
// Sport is the raw
// Strava sport_type; the handler maps it to the app sport category.
func (r *ActivityRepository) GetMapDataset(ctx context.Context, userID string) (activities []*activitiesv1.MapActivity, retErr error) {
	ctx, spanDone := otel.StartSpan(ctx, r.tracer, "repository.activities.map_dataset",
		attribute.String("db.system", dbSystem),
		attribute.String("db.name", dbName),
		attribute.String("db.operation", dbOpSelect),
		attribute.String("enduser.id", userID),
	)
	done := otel.RecordDuration(ctx, r.histogram, attribute.String("operation", "map_dataset"))
	defer func() {
		trace.SpanFromContext(ctx).SetAttributes(attribute.Int("result.row_count", len(activities)))
		done(retErr)
		spanDone(retErr)
	}()

	// One activity row per geo-bearing activity. The INNER JOIN to
	// activity_regions enforces the geo-only rule; array_agg(DISTINCT region_id)
	// collapses the many-to-many junction into the per-activity tag list (same
	// ids GetRouteRegionSummary / GET /map/regions return). The bbox is a LEFT
	// JOIN LATERAL over activity_routes so an activity tagged to a region but
	// (somehow) lacking route geometry still appears, just without a bbox.
	const query = `
		SELECT
			a.id,
			a.name,
			a.sport,
			a.distance,
			a.moving_time,
			a.total_elevation_gain,
			a.start_date_local,
			array_agg(DISTINCT ar.region_id ORDER BY ar.region_id) AS region_ids,
			bb.min_lng, bb.min_lat, bb.max_lng, bb.max_lat
		FROM desirelines.activities a
		JOIN desirelines.activity_regions ar ON ar.activity_id = a.id
		-- One route row per activity (activity_routes.activity_id is PK), so read
		-- the route's bbox directly via the O(1) accessors (they read the
		-- geometry's cached header) — no ST_Extent aggregate needed.
		LEFT JOIN LATERAL (
			SELECT
				ST_XMin(rt.route) AS min_lng,
				ST_YMin(rt.route) AS min_lat,
				ST_XMax(rt.route) AS max_lng,
				ST_YMax(rt.route) AS max_lat
			FROM desirelines.activity_routes rt
			WHERE rt.activity_id = a.id
		) bb ON true
		WHERE a.user_id = $1
		GROUP BY a.id, a.name, a.sport, a.distance, a.moving_time,
			a.total_elevation_gain, a.start_date_local,
			bb.min_lng, bb.min_lat, bb.max_lng, bb.max_lat
		ORDER BY a.start_date_local DESC, a.id DESC
	`

	rows, retErr := r.db.Query(ctx, query, userID)
	if retErr != nil {
		return nil, fmt.Errorf("query map dataset: %w", retErr)
	}
	defer rows.Close()

	activities = make([]*activitiesv1.MapActivity, 0)
	for rows.Next() {
		var (
			id             int64
			name           string
			sport          string
			distanceMeters float64
			movingTime     int32
			elevation      *float64
			startDateLocal time.Time
			regionIDs      []int64
			minLng         *float64
			minLat         *float64
			maxLng         *float64
			maxLat         *float64
		)

		if retErr = rows.Scan(
			&id, &name, &sport, &distanceMeters, &movingTime, &elevation,
			&startDateLocal, &regionIDs,
			&minLng, &minLat, &maxLng, &maxLat,
		); retErr != nil {
			return nil, fmt.Errorf("scan map dataset row: %w", retErr)
		}

		activity := &activitiesv1.MapActivity{
			ActivityId:      id,
			Name:            name,
			Sport:           sport,
			DistanceMeters:  distanceMeters,
			MovingTime:      movingTime,
			ElevationMeters: elevation,
			StartDateLocal:  startDateLocal.Format(time.RFC3339),
			RegionIds:       regionIDs,
		}
		if minLng != nil && minLat != nil && maxLng != nil && maxLat != nil {
			activity.Bbox = []float64{*minLng, *minLat, *maxLng, *maxLat}
		}

		activities = append(activities, activity)
	}

	if retErr = rows.Err(); retErr != nil {
		return nil, fmt.Errorf("iterate map dataset rows: %w", retErr)
	}
	return activities, nil
}

// encodeCursor encodes an ActivityCursor to a base64 string.
// Format: "timestamp|id" encoded as URL-safe base64.
func encodeCursor(cursor *repository.ActivityCursor) string {
	data := cursor.Timestamp + "|" + strconv.FormatInt(cursor.ID, 10)
	return base64.URLEncoding.EncodeToString([]byte(data))
}
