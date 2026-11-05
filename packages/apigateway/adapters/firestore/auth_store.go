// Package firestore provides Firestore-backed adapters for auth data storage.
package firestore

import (
	"context"
	"fmt"
	"strconv"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// AuthStore resolves activity owners and writes credentials/profile only while
// the same ownership pair and app admission remain valid.
type AuthStore struct {
	client *firestore.Client
}

// Compile-time check.
var _ auth.TokenStore = (*AuthStore)(nil)
var _ auth.ConnectionResolver = (*AuthStore)(nil)

// Resolve reads both active ownership directions before the OAuth grant is used.
func (s *AuthStore) Resolve(ctx context.Context, subject string) (activityconnection.Record, error) {
	record, err := (activityconnection.Store{Client: s.client}).Resolve(ctx, subject)
	if err != nil {
		return activityconnection.Record{}, fmt.Errorf("resolve auth owner: %w", err)
	}
	return record, nil
}

// NewAuthStore creates a new Firestore-backed auth store.
func NewAuthStore(client *firestore.Client) *AuthStore {
	return &AuthStore{client: client}
}

// WriteAuthData atomically writes both Strava tokens and athlete profile.
// Uses a Firestore transaction to ensure both writes succeed or both fail.
//
// Paths:
//   - users/{owner.UID}/private/strava_tokens
//   - users/{owner.UID}/private/profile
func (s *AuthStore) WriteAuthData(ctx context.Context, owner auth.CredentialOwner, tokens *stravatoken.Data, profile *auth.AthleteProfile) error {
	// Validate before the transaction so a bad grant is never partially
	// persisted. This is the only place the document is created, so it is the
	// one point where an incomplete write can still be prevented rather than
	// merely detected — the dispatcher's read-side Validate can only reject
	// what has already been stored.
	//
	// Failing here is deliberate: a grant missing an access or refresh token is
	// unusable, so persisting it would "succeed" the login and then break every
	// subsequent Strava call with an unrelated-looking auth error. The caller
	// already turns this into an OAuth error redirect.
	if tokens == nil {
		return fmt.Errorf("refusing nil tokens: %w", stravatoken.ErrIncompleteTokens)
	}
	if err := tokens.Validate(); err != nil {
		return fmt.Errorf("refusing to store tokens: %w", err)
	}
	if err := validateCredentialOrigin(owner, profile); err != nil {
		return err
	}

	userPrivate := s.client.Collection(stravatoken.UsersCollection).Doc(owner.UID).Collection(stravatoken.PrivateCollection)
	tokensRef := userPrivate.Doc(stravatoken.TokensDocument)
	profileRef := userPrivate.Doc(stravatoken.ProfileDocument)

	err := s.client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if err := s.checkCredentialOwner(tx, owner); err != nil {
			return err
		}
		// Firestore transactions require all reads before writes.
		// Preserve CreatedAt from existing profile (first-login timestamp).
		// On re-login, all other fields are updated but CreatedAt is retained.
		profileWrite := *profile
		existingDoc, getErr := tx.Get(profileRef)
		if getErr == nil {
			var existing auth.AthleteProfile
			if decodeErr := existingDoc.DataTo(&existing); decodeErr == nil && !existing.CreatedAt.IsZero() {
				profileWrite.CreatedAt = existing.CreatedAt
			}
		} else if status.Code(getErr) != codes.NotFound {
			return fmt.Errorf("get existing profile: %w", getErr)
		}

		if setErr := tx.Set(tokensRef, tokens); setErr != nil {
			return fmt.Errorf("set strava tokens: %w", setErr)
		}
		if setErr := tx.Set(profileRef, &profileWrite); setErr != nil {
			return fmt.Errorf("set athlete profile: %w", setErr)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("write auth data: %w", err)
	}
	return nil
}

func validateCredentialOrigin(owner auth.CredentialOwner, profile *auth.AthleteProfile) error {
	if activityconnection.ValidateUID(owner.UID) != nil {
		return activityconnection.ErrConflict
	}
	if _, err := activityconnection.LookupKey(owner.Subject); err != nil {
		return activityconnection.ErrConflict
	}
	if profile == nil || strconv.FormatInt(profile.StravaAthleteID, 10) != owner.Subject {
		return activityconnection.ErrConflict
	}
	return nil
}

func (s *AuthStore) checkCredentialOwner(tx *firestore.Transaction, owner auth.CredentialOwner) error {
	resolved, err := (activityconnection.Store{Client: s.client}).ResolveInTransaction(tx, owner.Subject)
	if err != nil {
		return fmt.Errorf("resolve credential owner: %w", err)
	}
	if resolved.UID != owner.UID || resolved.Subject != owner.Subject {
		return activityconnection.ErrConflict
	}
	if _, admissionErr := tx.Get(s.client.Collection(stravatoken.AllowlistCollection).Doc(owner.UID)); admissionErr != nil {
		if status.Code(admissionErr) == codes.NotFound {
			return activityconnection.ErrAdmissionDenied
		}
		return fmt.Errorf("read owner admission: %w", admissionErr)
	}
	return nil
}
