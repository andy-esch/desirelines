// Unit tests for the write-side token guard. Deliberately NOT behind the
// `integration` build tag that the rest of this package's tests carry: the
// guard must reject before any Firestore call, so proving it needs no live
// Firestore — and gating it behind a tag that requires one would mean the
// check went unexercised in the normal test run.
package firestore

import (
	"context"
	"errors"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// TestWriteAuthData_RejectsIncompleteTokens pins the write-side guard. This is
// the only place the strava_tokens document is created, so it is the last point
// at which an unusable grant can be prevented rather than merely detected —
// the dispatcher's read-side Validate can only reject what is already stored.
//
// Rejection must happen before the transaction: a partially-written grant would
// "succeed" the login and then fail every later Strava call with an error that
// points nowhere near the cause.
func TestWriteAuthData_RejectsIncompleteTokens(t *testing.T) {
	tests := []struct {
		name   string
		tokens *stravatoken.Data
	}{
		{
			name:   "missing access token",
			tokens: &stravatoken.Data{RefreshToken: "ref", ExpiresAt: 1735689600},
		},
		{
			name:   "missing refresh token",
			tokens: &stravatoken.Data{AccessToken: "acc", ExpiresAt: 1735689600},
		},
		{
			name:   "missing expiry",
			tokens: &stravatoken.Data{AccessToken: "acc", RefreshToken: "ref"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// A zero-valued store is safe precisely because validation must
			// return before anything touches the Firestore client. If this
			// panics, the guard is in the wrong place.
			store := &AuthStore{}
			err := store.WriteAuthData(context.Background(), "12345", tt.tokens, &auth.AthleteProfile{})

			if err == nil {
				t.Fatal("WriteAuthData accepted an incomplete grant")
			}
			if !errors.Is(err, stravatoken.ErrIncompleteTokens) {
				t.Errorf("err = %v, want it to wrap ErrIncompleteTokens", err)
			}
		})
	}
}
