// Package postgres provides PostgreSQL adapters for the repository interfaces.
// This is the infrastructure layer in hexagonal architecture, implementing
// the ports defined in the repository package.
//
// Components:
//   - Pool: Connection pool wrapper with serverless-optimized settings
//   - ActivityRepository: Implements repository.ActivityRepository for activities data
//
// The package uses pgx/v5 for PostgreSQL connectivity and provides:
//   - Cumulative metrics queries (GetSportMetrics, GetSportMetricsByDateRange)
//   - Daily summary queries (GetDailySummary, GetDailySummaryByDateRange)
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
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/jackc/pgx/v5"
)

// AggregationVersion is the version string for the data aggregation schema.
// Increment when the aggregation logic or data format changes.
const AggregationVersion = "2.0"

// ActivityRepository implements repository.ActivityRepository for PostgreSQL.
// This is an adapter in hexagonal architecture - infrastructure layer.
type ActivityRepository struct {
	pool *Pool
}

// Compile-time interface verification
var _ repository.ActivityRepository = (*ActivityRepository)(nil)

// NewActivityRepository creates a PostgreSQL activity repository.
func NewActivityRepository(pool *Pool) *ActivityRepository {
	return &ActivityRepository{pool: pool}
}

// Ping verifies database connectivity.
func (r *ActivityRepository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

// Close releases all database resources.
func (r *ActivityRepository) Close() error {
	r.pool.Close()
	return nil
}

// GetSportMetricsByDateRange returns cumulative metrics for an arbitrary date range.
// Unlike GetSportMetrics, this can span multiple years (e.g., Dec 2025 - Jan 2026).
// The query generates a dense timeseries from `from` to `to`,
// left joining with actual activity data and using COALESCE to fill zeros for days without activity.
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
//
// Performance note: Uses PostgreSQL's generate_series() for dense date generation.
// This is efficient for bounded ranges (max 366 days) as it:
//   - Executes entirely in the database (no round-trips)
//   - Uses PostgreSQL's optimized set-returning functions
//   - Computes cumulative sums via window functions in a single pass
//
// For very sparse data over long ranges, consider application-side date filling,
// but this adds complexity and memory overhead for cumulative sum calculation.
//
// See package documentation for timezone handling rationale.
func (r *ActivityRepository) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.SportMetrics, error) {
	query := `
		SELECT
			date,
			SUM(distance) OVER (ORDER BY date) as distance,
			SUM(elevation) OVER (ORDER BY date) as elevation,
			SUM(time) OVER (ORDER BY date) as time,
			SUM(activities) OVER (ORDER BY date)::int as activities
		FROM (
			SELECT
				all_dates.date,
				COALESCE(daily.distance, 0) as distance,
				COALESCE(daily.elevation, 0) as elevation,
				COALESCE(daily.time, 0) as time,
				COALESCE(daily.activities, 0) as activities
			FROM (
				SELECT generate_series($1::date, $2::date, '1 day'::interval)::date as date
			) all_dates
			LEFT JOIN (
				SELECT
					start_date_local::date as date,
					SUM(distance) as distance,
					SUM(total_elevation_gain) as elevation,
					SUM(moving_time) / 60.0 as time,
					COUNT(*) as activities
				FROM desirelines.activities
				WHERE start_date_local::date >= $1::date
				  AND start_date_local::date <= $2::date
				  AND type = ANY($3)
				GROUP BY start_date_local::date
			) daily ON all_dates.date = daily.date
		) dense_daily
		ORDER BY date ASC
	`

	rows, err := r.pool.Query(ctx, query, from, to, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query sport metrics by date range: %w", err)
	}
	defer rows.Close()

	return scanSportMetricsRows(rows)
}

// scanSportMetricsRows scans database rows into SportMetrics.
// Shared by both GetSportMetrics and GetSportMetricsByDateRange.
func scanSportMetricsRows(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
}) (*generated.SportMetrics, error) {
	timeseries := make([]*generated.CumulativeMetricsEntry, 0)
	for rows.Next() {
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int32

		if scanErr := rows.Scan(&date, &distance, &elevation, &timeMinutes, &activities); scanErr != nil {
			return nil, fmt.Errorf("scan sport metrics row: %w", scanErr)
		}

		entry := &generated.CumulativeMetricsEntry{
			Date:       date.Format("2006-01-02"),
			Distance:   &distance,
			Elevation:  &elevation,
			Time:       &timeMinutes,
			Activities: &activities,
		}

		timeseries = append(timeseries, entry)
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate sport metrics rows: %w", rowsErr)
	}

	return &generated.SportMetrics{Timeseries: timeseries}, nil
}

// GetSportMetrics returns cumulative metrics timeseries for a sport category in a given year.
// The query generates a dense timeseries from Jan 1 to today (or Dec 31 for past years),
// left joining with actual activity data and using COALESCE to fill zeros for days without activity.
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
func (r *ActivityRepository) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*generated.SportMetrics, error) {
	// Query structure:
	// 1. generate_series creates dates from Jan 1 to LEAST(today, Dec 31 of year)
	// 2. Left join with daily activity aggregates (only days with activities)
	// 3. COALESCE fills zeros for days without activity
	// 4. Window functions compute cumulative sums over the full date range
	query := `
		SELECT
			date,
			SUM(distance) OVER (ORDER BY date) as distance,
			SUM(elevation) OVER (ORDER BY date) as elevation,
			SUM(time) OVER (ORDER BY date) as time,
			SUM(activities) OVER (ORDER BY date)::int as activities
		FROM (
			SELECT
				all_dates.date,
				COALESCE(daily.distance, 0) as distance,
				COALESCE(daily.elevation, 0) as elevation,
				COALESCE(daily.time, 0) as time,
				COALESCE(daily.activities, 0) as activities
			FROM (
				SELECT generate_series(
					make_date($1, 1, 1),
					LEAST(CURRENT_DATE, make_date($1, 12, 31)),
					'1 day'::interval
				)::date as date
			) all_dates
			LEFT JOIN (
				SELECT
					start_date_local::date as date,
					SUM(distance) as distance,
					SUM(total_elevation_gain) as elevation,
					SUM(moving_time) / 60.0 as time,
					COUNT(*) as activities
				FROM desirelines.activities
				WHERE year = $1
				  AND type = ANY($2)
				GROUP BY start_date_local::date
			) daily ON all_dates.date = daily.date
		) dense_daily
		ORDER BY date ASC
	`

	rows, err := r.pool.Query(ctx, query, year, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query sport metrics: %w", err)
	}
	defer rows.Close()

	return scanSportMetricsRows(rows)
}

// GetDailySummary returns daily activity summaries for a sport category in a given year.
// Returns a map keyed by date (YYYY-MM-DD) with daily totals (not cumulative).
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
func (r *ActivityRepository) GetDailySummary(ctx context.Context, year int, sportTypes []string) (*generated.DailySummary, error) {
	query := `
		SELECT
			start_date_local::date as date,
			SUM(distance) as distance,
			SUM(total_elevation_gain) as elevation,
			SUM(moving_time) / 60.0 as time,
			COUNT(*) as activities,
			array_agg(id) as activity_ids
		FROM desirelines.activities
		WHERE year = $1
		  AND type = ANY($2)
		GROUP BY start_date_local::date
		ORDER BY start_date_local::date ASC
	`

	rows, err := r.pool.Query(ctx, query, year, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query daily summary: %w", err)
	}
	defer rows.Close()

	return scanDailySummaryRows(rows)
}

// scanDailySummaryRows scans database rows into DailySummary.
// Shared by both GetDailySummary and GetDailySummaryByDateRange.
func scanDailySummaryRows(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
}) (*generated.DailySummary, error) {
	summary := &generated.DailySummary{
		Daily: make(map[string]*generated.DailyActivity),
	}
	for rows.Next() {
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int32
		var activityIDs []int64

		if scanErr := rows.Scan(&date, &distance, &elevation, &timeMinutes, &activities, &activityIDs); scanErr != nil {
			return nil, fmt.Errorf("scan daily summary row: %w", scanErr)
		}

		dateStr := date.Format("2006-01-02")
		summary.Daily[dateStr] = &generated.DailyActivity{
			DistanceMeters:  &distance,
			ElevationMeters: &elevation,
			TimeMinutes:     &timeMinutes,
			Activities:      activities,
			ActivityIds:     activityIDs,
		}
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate daily summary rows: %w", rowsErr)
	}

	return summary, nil
}

// GetDailySummaryByDateRange returns daily activity summaries for a date range.
// Returns a map keyed by date (YYYY-MM-DD) with daily totals (not cumulative).
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
func (r *ActivityRepository) GetDailySummaryByDateRange(ctx context.Context, from, to string, sportTypes []string) (*generated.DailySummary, error) {
	query := `
		SELECT
			start_date_local::date as date,
			SUM(distance) as distance,
			SUM(total_elevation_gain) as elevation,
			SUM(moving_time) / 60.0 as time,
			COUNT(*) as activities,
			array_agg(id) as activity_ids
		FROM desirelines.activities
		WHERE start_date_local::date >= $1::date
		  AND start_date_local::date <= $2::date
		  AND type = ANY($3)
		GROUP BY start_date_local::date
		ORDER BY start_date_local::date ASC
	`

	rows, err := r.pool.Query(ctx, query, from, to, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query daily summary by date range: %w", err)
	}
	defer rows.Close()

	return scanDailySummaryRows(rows)
}

// GetYearMetadata returns metadata about activities for a given year.
// Includes list of sports, per-sport totals, and last updated timestamp.
func (r *ActivityRepository) GetYearMetadata(ctx context.Context, year int) (*generated.YearMetadata, error) {
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
		WHERE year = $1
		GROUP BY sport
		ORDER BY sport ASC
	`

	rows, err := r.pool.Query(ctx, query, year)
	if err != nil {
		return nil, fmt.Errorf("query year metadata: %w", err)
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

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate year metadata rows: %w", rowsErr)
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
func (r *ActivityRepository) GetActivityByID(ctx context.Context, id int64) (*activitiesv1.Activity, error) {
	query := `
		SELECT
			id, name, type, sport, start_date_local,
			distance, moving_time, elapsed_time,
			total_elevation_gain, average_speed, max_speed,
			average_heartrate, max_heartrate
		FROM desirelines.activities
		WHERE id = $1
	`

	row := r.pool.QueryRow(ctx, query, id)

	var activityID int64
	var name, activityType, sport string
	var startDateLocal time.Time
	var distanceMeters float64
	var movingTime, elapsedTime int32
	var elevation, avgSpeed, maxSpeed, avgHR, maxHR *float64

	err := row.Scan(
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

	if err != nil {
		// Check for not found - pgx returns specific error
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query activity by id: %w", err)
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

// addCondition appends a WHERE condition with a single parameter.
// The format string should contain exactly one %d placeholder for the argument number.
func (qb *queryBuilder) addCondition(format string, arg interface{}) {
	qb.query += fmt.Sprintf(format, qb.argNum)
	qb.args = append(qb.args, arg)
	qb.argNum++
}

// addCondition2 appends a WHERE condition with two parameters.
// The format string should contain exactly two %d placeholders for consecutive argument numbers.
func (qb *queryBuilder) addCondition2(format string, arg1, arg2 interface{}) {
	qb.query += fmt.Sprintf(format, qb.argNum, qb.argNum+1)
	qb.args = append(qb.args, arg1, arg2)
	qb.argNum += 2
}

// append adds a literal string to the query (no parameters).
func (qb *queryBuilder) append(s string) {
	qb.query += s
}

// ListActivities returns activities matching the filter criteria with cursor-based pagination.
// Results are ordered by (start_date_local DESC, id DESC) for stable ordering.
// Uses keyset pagination for O(1) performance regardless of offset.
func (r *ActivityRepository) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*activitiesv1.ListActivitiesResponse, error) {
	// Build query dynamically based on filter
	// We fetch limit+1 to determine if there are more results
	qb := newQueryBuilder(`
		SELECT
			id, name, type, sport, start_date_local,
			distance, moving_time, total_elevation_gain
		FROM desirelines.activities
		WHERE 1=1
	`)

	// Add date range filters
	if filter.From != nil {
		qb.addCondition(" AND start_date_local >= $%d::date", *filter.From)
	}

	if filter.To != nil {
		// Add 1 day to make 'to' inclusive (end of day)
		qb.addCondition(" AND start_date_local < ($%d::date + interval '1 day')", *filter.To)
	}

	// Add sport filter (filter on 'type' column which contains Strava types)
	if len(filter.SportTypes) > 0 {
		qb.addCondition(" AND type = ANY($%d)", filter.SportTypes)
	}

	// Add cursor constraint for pagination
	if filter.Cursor != nil {
		// Keyset pagination: get rows where (start_date_local, id) < (cursor.timestamp, cursor.id)
		// This works because we order by start_date_local DESC, id DESC
		qb.addCondition2(" AND (start_date_local, id) < ($%d::timestamp, $%d)", filter.Cursor.Timestamp, filter.Cursor.ID)
	}

	// Order by for stable pagination
	qb.append(" ORDER BY start_date_local DESC, id DESC")

	// Limit (+1 to detect if there are more results)
	limit := filter.Limit
	if limit <= 0 {
		limit = 20 // Default limit
	}
	if limit > 100 {
		limit = 100 // Max limit
	}
	qb.addCondition(" LIMIT $%d", limit+1)

	rows, err := r.pool.Query(ctx, qb.query, qb.args...)
	if err != nil {
		return nil, fmt.Errorf("query activities list: %w", err)
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

		if scanErr := rows.Scan(
			&id,
			&name,
			&activityType,
			&sport,
			&startDateLocal,
			&distanceMeters,
			&movingTime,
			&elevation,
		); scanErr != nil {
			return nil, fmt.Errorf("scan activity row: %w", scanErr)
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

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate activities rows: %w", rowsErr)
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

// encodeCursor encodes an ActivityCursor to a base64 string.
// Format: "timestamp|id" encoded as URL-safe base64.
func encodeCursor(cursor *repository.ActivityCursor) string {
	data := cursor.Timestamp + "|" + strconv.FormatInt(cursor.ID, 10)
	return base64.URLEncoding.EncodeToString([]byte(data))
}
