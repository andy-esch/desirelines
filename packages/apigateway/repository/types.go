// Package repository defines domain interfaces and types for data access.
//
// API types (Activity, ActivitySummary, ListActivitiesResponse) are now defined
// in the activitiesv1 protobuf package for consistent serialization across
// Go and TypeScript.
//
// This file contains internal types used by the repository layer.
package repository

// DefaultListLimit is the default number of items to return per page.
const DefaultListLimit = 20

// MaxListLimit is the maximum number of items allowed per page.
const MaxListLimit = 100

// =============================================================================
// Pagination Types (Internal)
// =============================================================================

// ActivityCursor represents the pagination cursor for activity lists.
// Encoded as base64 in the API. Uses (timestamp, id) for stable keyset pagination.
type ActivityCursor struct {
	Timestamp string `json:"t"`  // ISO timestamp of last item (start_date_local)
	ID        int64  `json:"id"` // Activity ID of last item (tiebreaker)
}

// NormalizedRoute represents an activity route centered at (0,0) for art visualization.
// Used by the /routes page to render abstract route art on a canvas.
type NormalizedRoute struct {
	ActivityID int64       `json:"activityId"`
	Name       string      `json:"name"`
	Sport      string      `json:"sport"`
	Distance   float64     `json:"distance"`
	Date       string      `json:"date"`
	Coords     [][]float64 `json:"coords"`
}

// RoutesResponse wraps normalized routes for the visualization endpoint.
type RoutesResponse struct {
	Routes []NormalizedRoute `json:"routes"`
}

// RegionSummary describes one region the user has activities in: the activity
// count and the region's bounding box [minLng, minLat, maxLng, maxLat]. Used by
// GET /activities/map/regions to pick the default map viewport (the densest
// region). The builtin "earth" region (whole-world bbox) is the catch-all for
// activities with real geometry that fall outside the active boundary dataset.
type RegionSummary struct {
	RegionID      int64      `json:"regionId"`
	Name          string     `json:"name"`
	Kind          string     `json:"kind"`
	ActivityCount int        `json:"activityCount"`
	BBox          [4]float64 `json:"bbox"`
}

// RegionsResponse wraps region summaries for the routes-map endpoint.
//
// Regions is ordered by activity count (densest first) for the region filter.
// DefaultViewport is the region the client should fit the map to on load — chosen
// by region-kind priority (metro CBSA > micro CBSA > county > earth), then count
// within that kind. Picking within a single kind avoids the tag-all skew where an
// activity is counted in both its county and its overlapping CBSA, which would
// make a raw cross-kind "densest" comparison meaningless. nil when the user has no
// geo-bearing activities.
type RegionsResponse struct {
	Regions         []RegionSummary `json:"regions"`
	DefaultViewport *RegionSummary  `json:"defaultViewport,omitempty"`
}

// DefaultRoutesLimit is the default number of routes to return.
const DefaultRoutesLimit = 500

// MaxRoutesLimit is the maximum number of routes allowed.
const MaxRoutesLimit = 1000

// ActivityListFilter contains query filters for listing activities.
// Used internally by the repository layer.
type ActivityListFilter struct {
	UserID     string          // Authenticated user's ID (required for query isolation)
	From       *string         // Start date (YYYY-MM-DD), inclusive
	To         *string         // End date (YYYY-MM-DD), inclusive
	SportTypes []string        // Strava sport_type values (e.g., ["Ride", "VirtualRide"])
	Limit      int             // Max results to return
	Cursor     *ActivityCursor // Cursor for pagination (nil for first page)
}
