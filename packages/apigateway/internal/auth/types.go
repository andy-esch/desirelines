package auth

import "time"

// StravaTokenResponse is the JSON response from Strava's token endpoint.
type StravaTokenResponse struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresAt    int64         `json:"expires_at"`
	ExpiresIn    int           `json:"expires_in"`
	Athlete      StravaAthlete `json:"athlete"`

	// Scope is tagged for JSON but Strava's POST /oauth/token does NOT include
	// a "scope" field in the response body — this is always empty in practice.
	// The granted scope comes from the callback query parameter instead.
	// See validateScope in handler.go for the fallback logic.
	Scope string `json:"scope"`
}

// StravaAthlete is the athlete object nested in Strava's token response.
type StravaAthlete struct {
	ID        int64  `json:"id"`
	FirstName string `json:"firstname"`
	LastName  string `json:"lastname"`
	Profile   string `json:"profile"`
}

// AthleteProfile is the Firestore document schema for the user profile.
// Stored at users/{athleteID}/private/profile.
type AthleteProfile struct {
	StravaAthleteID int64     `firestore:"strava_athlete_id"`
	FirstName       string    `firestore:"first_name"`
	LastName        string    `firestore:"last_name"`
	ProfileURL      string    `firestore:"profile_url"`
	CreatedAt       time.Time `firestore:"created_at"`
}
