// Package stravatoken provides shared types and Firestore path constants
// for Strava OAuth token storage. Both apigateway and dispatcher depend on
// this package to keep their Firestore access in sync.
package stravatoken

import "time"

// Firestore collection and document path components.
// Both apigateway and dispatcher use these to build document references.
const (
	UsersCollection     = "users"
	PrivateCollection   = "private"
	TokensDocument      = "strava_tokens" //nolint:gosec // Document name, not credential
	ProfileDocument     = "profile"
	AllowlistCollection = "allowlist"
)

// Data is the Firestore document schema for per-user Strava tokens.
// Stored at users/{athleteID}/private/strava_tokens.
type Data struct {
	AccessToken   string    `firestore:"access_token"`
	RefreshToken  string    `firestore:"refresh_token"`
	ExpiresAt     int64     `firestore:"expires_at"`
	Scopes        string    `firestore:"scopes"`
	ConnectedAt   time.Time `firestore:"connected_at"`
	LastRefreshed time.Time `firestore:"last_refreshed"`
}
