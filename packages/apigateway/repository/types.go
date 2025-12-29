// Package repository defines domain interfaces and types for data access.
//
// Empty Data Convention:
// All slice fields MUST be initialized as empty slices (not nil) to ensure
// proper JSON serialization. Go's nil slices serialize to JSON null, but our
// API contract requires empty arrays [].
//
// Use: make([]T, 0)  -- serializes to []
// Not: var s []T     -- serializes to null
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

// =============================================================================
// Individual Activity Types
// =============================================================================

// Activity represents a single activity with full details.
// This is the response format for GET /activities/{id}
type Activity struct {
	ID                 int64    `json:"id"`
	Name               string   `json:"name"`
	Type               string   `json:"type"`                        // Strava activity type (Run, Ride, etc.)
	Sport              string   `json:"sport"`                       // Categorized sport (running, cycling, yoga)
	StartDateLocal     string   `json:"start_date_local"`            // ISO timestamp
	DistanceMeters     float64  `json:"distance_meters"`             // Distance in meters
	MovingTimeSeconds  int      `json:"moving_time_seconds"`         // Moving time in seconds
	ElapsedTimeSeconds int      `json:"elapsed_time_seconds"`        // Total elapsed time in seconds
	ElevationMeters    *float64 `json:"elevation_meters,omitempty"`  // Elevation gain in meters
	AverageSpeedMps    *float64 `json:"average_speed_mps,omitempty"` // Average speed in m/s
	MaxSpeedMps        *float64 `json:"max_speed_mps,omitempty"`     // Max speed in m/s
	AverageHeartrate   *float64 `json:"average_heartrate,omitempty"` // Average heart rate (bpm)
	MaxHeartrate       *float64 `json:"max_heartrate,omitempty"`     // Max heart rate (bpm)
}

// ActivitySummary represents a condensed activity for list views.
// Used in the activities array of ActivityListResponse.
type ActivitySummary struct {
	ID                int64    `json:"id"`
	Name              string   `json:"name"`
	Type              string   `json:"type"`                       // Strava activity type
	Sport             string   `json:"sport"`                      // Categorized sport
	StartDateLocal    string   `json:"start_date_local"`           // ISO timestamp
	DistanceMeters    float64  `json:"distance_meters"`            // Distance in meters
	MovingTimeSeconds int      `json:"moving_time_seconds"`        // Moving time in seconds
	ElevationMeters   *float64 `json:"elevation_meters,omitempty"` // Elevation gain in meters
}

// ActivityListResponse is the cursor-paginated list response.
// This is the response format for GET /activities
type ActivityListResponse struct {
	Activities []ActivitySummary `json:"activities"`
	NextCursor *string           `json:"next_cursor,omitempty"` // Base64-encoded cursor for next page
	HasMore    bool              `json:"has_more"`              // True if more results available
}

// ActivityCursor represents the pagination cursor for activity lists.
// Encoded as base64 JSON in the API. Uses (timestamp, id) for stable keyset pagination.
type ActivityCursor struct {
	Timestamp string `json:"t"`  // ISO timestamp of last item (start_date_local)
	ID        int64  `json:"id"` // Activity ID of last item (tiebreaker)
}

// ActivityListFilter contains query filters for listing activities.
// Used internally by the repository layer.
type ActivityListFilter struct {
	From       *string         // Start date (YYYY-MM-DD), inclusive
	To         *string         // End date (YYYY-MM-DD), inclusive
	SportTypes []string        // Strava sport_type values (e.g., ["Ride", "VirtualRide"])
	Limit      int             // Max results to return
	Cursor     *ActivityCursor // Cursor for pagination (nil for first page)
}
