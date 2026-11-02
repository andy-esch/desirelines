package auth

import (
	"context"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// StravaOAuthClient exchanges an authorization code for tokens.
type StravaOAuthClient interface {
	ExchangeCode(ctx context.Context, code string) (*StravaTokenResponse, error)
	AuthorizeURL() string
}

// ConnectionResolver resolves a provider subject to an active ownership pair.
// Missing, inactive or inconsistent ownership must fail closed.
type ConnectionResolver interface {
	Resolve(ctx context.Context, subject string) (activityconnection.Record, error)
}

// CredentialOwner pins the app UID and provider subject that supplied a grant.
// It is copied by value so transaction retries cannot change the destination.
type CredentialOwner struct{ UID, Subject string }

// TokenStore manages per-user Strava tokens and profiles in Firestore.
type TokenStore interface {
	// WriteAuthData revalidates owner and admission in the same transaction as
	// the credential/profile writes. A retry must never retarget credentials.
	WriteAuthData(ctx context.Context, owner CredentialOwner, tokens *stravatoken.Data, profile *AthleteProfile) error
}

// FirebaseAuthClient creates Firebase Custom Auth tokens and manages user profiles.
// firebase.google.com/go/v4/auth.Client satisfies this interface directly.
type FirebaseAuthClient interface {
	CustomToken(ctx context.Context, uid string) (string, error)
	UpdateUser(ctx context.Context, uid string, user *firebaseauth.UserToUpdate) (*firebaseauth.UserRecord, error)
}
