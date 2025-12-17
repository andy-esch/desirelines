package postgres

import (
	"context"
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

// GetSportMetrics returns cumulative metrics timeseries for a sport category in a given year.
// The query aggregates daily activities then computes running totals using window functions.
// sportTypes is a list of Strava sport_type values (e.g., ["Ride", "VirtualRide"] for cycling).
func (r *ActivityRepository) GetSportMetrics(ctx context.Context, year int, sportTypes []string) (*repository.SportMetrics, error) {
	// Query aggregates by day, then computes cumulative sums
	// Inner query: daily aggregates
	// Outer query: running totals via window functions
	query := `
		SELECT
			date,
			SUM(distance) OVER (ORDER BY date) as distance,
			SUM(elevation) OVER (ORDER BY date) as elevation,
			SUM(time) OVER (ORDER BY date) as time,
			SUM(activities) OVER (ORDER BY date)::int as activities
		FROM (
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
		) daily
		ORDER BY date ASC
	`

	rows, err := r.pool.Query(ctx, query, year, sportTypes)
	if err != nil {
		return nil, fmt.Errorf("query sport metrics: %w", err)
	}
	defer rows.Close()

	var timeseries []repository.CumulativeMetricsEntry
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

	var sports []string
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
