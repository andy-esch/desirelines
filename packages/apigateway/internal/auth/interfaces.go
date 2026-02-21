package auth

import "context"

// StravaOAuthClient exchanges an authorization code for tokens.
type StravaOAuthClient interface {
	ExchangeCode(ctx context.Context, code string) (*StravaTokenResponse, error)
}

// TokenStore manages per-user Strava tokens and profiles in Firestore.
type TokenStore interface {
	// WriteAuthData atomically writes both tokens and profile for an athlete.
	// Both writes succeed or both fail.
	WriteAuthData(ctx context.Context, athleteID string, tokens *StravaTokenData, profile *AthleteProfile) error
}

// AllowlistChecker verifies if an athlete ID is in the allowlist.
type AllowlistChecker interface {
	IsAllowed(ctx context.Context, athleteID string) (bool, error)
}

// FirebaseTokenCreator creates Firebase Custom Auth tokens.
// firebase.google.com/go/v4/auth.Client satisfies this interface directly
// via its CustomToken method.
type FirebaseTokenCreator interface {
	CustomToken(ctx context.Context, uid string) (string, error)
}
