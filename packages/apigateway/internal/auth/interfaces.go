package auth

import (
	"context"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// StravaOAuthClient exchanges an authorization code for tokens.
type StravaOAuthClient interface {
	ExchangeCode(ctx context.Context, code string) (*StravaTokenResponse, error)
	AuthorizeURL() string
}

// TokenStore manages per-user Strava tokens and profiles in Firestore.
type TokenStore interface {
	// WriteAuthData atomically writes both tokens and profile for an athlete.
	// Both writes succeed or both fail.
	WriteAuthData(ctx context.Context, athleteID string, tokens *stravatoken.Data, profile *AthleteProfile) error
}

// FirebaseAuthClient creates Firebase Custom Auth tokens and manages user profiles.
// firebase.google.com/go/v4/auth.Client satisfies this interface directly.
type FirebaseAuthClient interface {
	CustomToken(ctx context.Context, uid string) (string, error)
	UpdateUser(ctx context.Context, uid string, user *firebaseauth.UserToUpdate) (*firebaseauth.UserRecord, error)
}
