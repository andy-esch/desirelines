// Package repository defines domain interfaces and types for data access.
package repository

// CumulativeMetricsEntry represents a single point in the cumulative metrics timeseries.
// All numeric values are running totals up to and including this date.
type CumulativeMetricsEntry struct {
	Date       string   `json:"date"`                 // ISO date: "2024-01-15"
	Distance   *float64 `json:"distance,omitempty"`   // Cumulative distance in meters
	Elevation  *float64 `json:"elevation,omitempty"`  // Cumulative elevation gain in meters
	Time       *float64 `json:"time,omitempty"`       // Cumulative time in minutes
	Activities *int     `json:"activities,omitempty"` // Cumulative activity count
}

// SportMetrics represents the metrics timeseries for a sport in a given year.
// This is the response format for GET /activities/{year}/metrics?sport=X
type SportMetrics struct {
	Timeseries []CumulativeMetricsEntry `json:"timeseries"`
}

// DailyActivity represents activity data for a single day.
// Values are daily totals (NOT cumulative).
type DailyActivity struct {
	DistanceMeters  *float64 `json:"distance_meters,omitempty"`  // Distance in meters
	TimeMinutes     *float64 `json:"time_minutes,omitempty"`     // Time in minutes
	ElevationMeters *float64 `json:"elevation_meters,omitempty"` // Elevation gain in meters
	Activities      int      `json:"activities"`                 // Number of activities
	ActivityIDs     []int64  `json:"activity_ids"`               // Strava activity IDs
}

// DailySummary represents daily activity summaries keyed by date.
// This is the response format for GET /activities/{year}/source?sport=X
// The map key is the date in YYYY-MM-DD format.
type DailySummary map[string]*DailyActivity

// SportTotals represents aggregate metrics for a single sport.
type SportTotals struct {
	DistanceMeters  *float64 `json:"distance_meters,omitempty"`  // Total distance in meters
	TimeMinutes     *float64 `json:"time_minutes,omitempty"`     // Total time in minutes
	ElevationMeters *float64 `json:"elevation_meters,omitempty"` // Total elevation gain in meters
	Activities      int      `json:"activities"`                 // Total activity count
}

// YearMetadata represents metadata about activities for a given year.
// This is the response format for GET /activities/{year}/metadata
type YearMetadata struct {
	Year               int                     `json:"year"`
	Sports             []string                `json:"sports"`                 // List of sports with activities
	Totals             map[string]*SportTotals `json:"totals"`                 // Per-sport totals
	LastUpdated        *string                 `json:"last_updated,omitempty"` // ISO timestamp
	AggregationVersion string                  `json:"aggregation_version"`    // Version for cache busting
}

// DistanceEntry represents a single point in the legacy distance timeseries.
// Uses x/y naming for backward compatibility with existing web frontend.
type DistanceEntry struct {
	X string  `json:"x"` // Date in ISO format: "2024-01-15"
	Y float64 `json:"y"` // Cumulative distance in meters
}
