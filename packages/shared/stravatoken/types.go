// Package stravatoken provides shared types for Strava OAuth token storage.
package stravatoken

import "time"

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
