package postgres

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/repository"
)

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
func (r *ActivityRepository) GetSportMetricsByDateRange(ctx context.Context, from, to string, sportTypes []string) (*repository.SportMetrics, error) {
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
				  AND sport = ANY($3)
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
}) (*repository.SportMetrics, error) {
	timeseries := make([]repository.CumulativeMetricsEntry, 0)
	for rows.Next() {
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int

		if scanErr := rows.Scan(&date, &distance, &elevation, &timeMinutes, &activities); scanErr != nil {
			return nil, fmt.Errorf("scan sport metrics row: %w", scanErr)
		}

		entry := repository.CumulativeMetricsEntry{
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

	return &repository.SportMetrics{Timeseries: timeseries}, nil
}

// GetSportMetrics returns cumulative metrics timeseries for a sport category in a given year.
// The query generates a dense timeseries from Jan 1 to today (or Dec 31 for past years),
// left joining with actual activity data and using COALESCE to fill zeros for days without activity.
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
func (r *ActivityRepository) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*repository.SportMetrics, error) {
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
				  AND sport = ANY($2)
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
func (r *ActivityRepository) GetDailySummary(ctx context.Context, year int, sportTypes []string) (repository.DailySummary, error) {
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
		  AND sport = ANY($2)
		GROUP BY start_date_local::date
		ORDER BY start_date_local::date ASC
	`

	rows, err := r.pool.Query(ctx, query, year, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query daily summary: %w", err)
	}
	defer rows.Close()

	summary := make(repository.DailySummary)
	for rows.Next() {
		var date time.Time
		var distance, elevation, timeMinutes float64
		var activities int
		var activityIDs []int64

		if scanErr := rows.Scan(&date, &distance, &elevation, &timeMinutes, &activities, &activityIDs); scanErr != nil {
			return nil, fmt.Errorf("scan daily summary row: %w", scanErr)
		}

		dateStr := date.Format("2006-01-02")
		summary[dateStr] = &repository.DailyActivity{
			DistanceMeters:  &distance,
			ElevationMeters: &elevation,
			TimeMinutes:     &timeMinutes,
			Activities:      activities,
			ActivityIDs:     activityIDs,
		}
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate daily summary rows: %w", rowsErr)
	}

	return summary, nil
}

// GetYearMetadata returns metadata about activities for a given year.
// Includes list of sports, per-sport totals, and last updated timestamp.
func (r *ActivityRepository) GetYearMetadata(ctx context.Context, year int) (*repository.YearMetadata, error) {
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
	totals := make(map[string]*repository.SportTotals)
	var latestUpdate *time.Time

	for rows.Next() {
		var sport string
		var distance, elevation, timeMinutes float64
		var activities int
		var lastUpdated *time.Time

		if scanErr := rows.Scan(&sport, &distance, &elevation, &timeMinutes, &activities, &lastUpdated); scanErr != nil {
			return nil, fmt.Errorf("scan year metadata row: %w", scanErr)
		}

		sports = append(sports, sport)
		totals[sport] = &repository.SportTotals{
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

	return &repository.YearMetadata{
		Year:               year,
		Sports:             sports,
		Totals:             totals,
		LastUpdated:        lastUpdatedStr,
		AggregationVersion: "2.0", // Hardcoded version for now
	}, nil
}

// GetActivityByID returns a single activity by its Strava ID.
// Returns nil (not error) if the activity is not found.
func (r *ActivityRepository) GetActivityByID(ctx context.Context, id int64) (*repository.Activity, error) {
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

	var activity repository.Activity
	var startDateLocal time.Time
	var elevation, avgSpeed, maxSpeed, avgHR, maxHR *float64

	err := row.Scan(
		&activity.ID,
		&activity.Name,
		&activity.Type,
		&activity.Sport,
		&startDateLocal,
		&activity.DistanceMeters,
		&activity.MovingTimeSeconds,
		&activity.ElapsedTimeSeconds,
		&elevation,
		&avgSpeed,
		&maxSpeed,
		&avgHR,
		&maxHR,
	)

	if err != nil {
		// Check for not found - pgx returns specific error
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query activity by id: %w", err)
	}

	activity.StartDateLocal = startDateLocal.Format(time.RFC3339)
	activity.ElevationMeters = elevation
	activity.AverageSpeedMps = avgSpeed
	activity.MaxSpeedMps = maxSpeed
	activity.AverageHeartrate = avgHR
	activity.MaxHeartrate = maxHR

	return &activity, nil
}

// ListActivities returns activities matching the filter criteria with cursor-based pagination.
// Results are ordered by (start_date_local DESC, id DESC) for stable ordering.
// Uses keyset pagination for O(1) performance regardless of offset.
func (r *ActivityRepository) ListActivities(ctx context.Context, filter repository.ActivityListFilter) (*repository.ActivityListResponse, error) {
	// Build query dynamically based on filter
	// We fetch limit+1 to determine if there are more results

	var query string
	var args []interface{}
	argNum := 1

	// Base SELECT
	baseSelect := `
		SELECT
			id, name, type, sport, start_date_local,
			distance, moving_time, total_elevation_gain
		FROM desirelines.activities
		WHERE 1=1
	`

	query = baseSelect

	// Add date range filters
	if filter.From != nil {
		query += fmt.Sprintf(" AND start_date_local >= $%d::date", argNum)
		args = append(args, *filter.From)
		argNum++
	}

	if filter.To != nil {
		// Add 1 day to make 'to' inclusive (end of day)
		query += fmt.Sprintf(" AND start_date_local < ($%d::date + interval '1 day')", argNum)
		args = append(args, *filter.To)
		argNum++
	}

	// Add sport filter
	if len(filter.SportTypes) > 0 {
		query += fmt.Sprintf(" AND sport = ANY($%d)", argNum)
		args = append(args, filter.SportTypes)
		argNum++
	}

	// Add cursor constraint for pagination
	if filter.Cursor != nil {
		// Keyset pagination: get rows where (start_date_local, id) < (cursor.timestamp, cursor.id)
		// This works because we order by start_date_local DESC, id DESC
		query += fmt.Sprintf(" AND (start_date_local, id) < ($%d::timestamp, $%d)", argNum, argNum+1)
		args = append(args, filter.Cursor.Timestamp, filter.Cursor.ID)
		argNum += 2
	}

	// Order by for stable pagination
	query += " ORDER BY start_date_local DESC, id DESC"

	// Limit (+1 to detect if there are more results)
	limit := filter.Limit
	if limit <= 0 {
		limit = 20 // Default limit
	}
	if limit > 100 {
		limit = 100 // Max limit
	}
	query += fmt.Sprintf(" LIMIT $%d", argNum)
	args = append(args, limit+1)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query activities list: %w", err)
	}
	defer rows.Close()

	activities := make([]repository.ActivitySummary, 0, limit)
	for rows.Next() {
		var activity repository.ActivitySummary
		var startDateLocal time.Time
		var elevation *float64

		if scanErr := rows.Scan(
			&activity.ID,
			&activity.Name,
			&activity.Type,
			&activity.Sport,
			&startDateLocal,
			&activity.DistanceMeters,
			&activity.MovingTimeSeconds,
			&elevation,
		); scanErr != nil {
			return nil, fmt.Errorf("scan activity row: %w", scanErr)
		}

		activity.StartDateLocal = startDateLocal.Format(time.RFC3339)
		activity.ElevationMeters = elevation

		activities = append(activities, activity)
	}

	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("iterate activities rows: %w", rowsErr)
	}

	// Determine if there are more results
	hasMore := len(activities) > limit
	if hasMore {
		// Remove the extra row we fetched
		activities = activities[:limit]
	}

	// Build next cursor from last activity
	var nextCursor *string
	if hasMore && len(activities) > 0 {
		lastActivity := activities[len(activities)-1]
		cursor := repository.ActivityCursor{
			Timestamp: lastActivity.StartDateLocal,
			ID:        lastActivity.ID,
		}
		encoded := encodeCursor(&cursor)
		nextCursor = &encoded
	}

	return &repository.ActivityListResponse{
		Activities: activities,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// encodeCursor encodes an ActivityCursor to a base64 string.
// Uses simple "timestamp|id" format rather than JSON for efficiency.
func encodeCursor(cursor *repository.ActivityCursor) string {
	data := fmt.Sprintf("%s|%d", cursor.Timestamp, cursor.ID)
	return base64.URLEncoding.EncodeToString([]byte(data))
}
