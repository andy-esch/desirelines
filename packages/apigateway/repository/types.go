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

// ActivityListFilter contains query filters for listing activities.
// Used internally by the repository layer.
type ActivityListFilter struct {
	From       *string         // Start date (YYYY-MM-DD), inclusive
	To         *string         // End date (YYYY-MM-DD), inclusive
	SportTypes []string        // Strava sport_type values (e.g., ["Ride", "VirtualRide"])
	Limit      int             // Max results to return
	Cursor     *ActivityCursor // Cursor for pagination (nil for first page)
}
