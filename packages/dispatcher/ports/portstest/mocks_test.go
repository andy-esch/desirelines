package portstest_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

const athleteID = int64(42)

func refreshed(access string) *stravatoken.Data {
	return &stravatoken.Data{AccessToken: access, RefreshToken: access + "-refresh", ExpiresAt: 100}
}

// Without Versioned, writes are only recorded, as a copy, with a zero version.
func TestMockTokenStore_UnversionedRecordsACopy(t *testing.T) {
	store := &portstest.MockTokenStore{}
	tokens := refreshed("a")

	version, err := store.WriteTokensIfUnmodified(context.Background(), athleteID, tokens, time.Unix(99, 0))
	if err != nil || !version.IsZero() {
		t.Fatalf("WriteTokensIfUnmodified() = %v, %v; want zero version, nil", version, err)
	}
	tokens.AccessToken = "changed after the write"
	if got := store.WrittenTokens[athleteID].AccessToken; got != "a" {
		t.Errorf("recorded access token = %q, want %q: the record must not alias the caller's struct", got, "a")
	}
}

// Versioned mode enforces the expected version like the real store, updates only
// the refreshed fields, and never reissues a version, even one a test seeded.
func TestMockTokenStore_VersionedEnforcesTheVersion(t *testing.T) {
	ctx := context.Background()
	connectedAt := time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)
	seeded := time.Unix(2, 0).UTC()
	store := &portstest.MockTokenStore{
		Versioned: true,
		Tokens: map[int64]*stravatoken.Data{
			athleteID: {AccessToken: "old", Scopes: "read", ConnectedAt: connectedAt, LastRefreshed: seeded},
		},
	}

	if _, err := store.WriteTokensIfUnmodified(ctx, 7, refreshed("x"), time.Time{}); !errors.Is(err, ports.ErrTokenNotFound) {
		t.Errorf("write for a missing athlete: error = %v, want ErrTokenNotFound", err)
	}
	if _, err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed("x"), time.Time{}); !errors.Is(err, ports.ErrTokenConflict) {
		t.Errorf("write with a stale version: error = %v, want ErrTokenConflict", err)
	}

	first, err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed("first"), seeded)
	if err != nil {
		t.Fatalf("write with the stored version: %v", err)
	}
	if !first.After(seeded) {
		t.Errorf("new version %v is not after the seeded %v", first, seeded)
	}
	stored := store.Tokens[athleteID]
	if stored.AccessToken != "first" || stored.RefreshToken != "first-refresh" || stored.ExpiresAt != 100 || !stored.LastRefreshed.Equal(first) {
		t.Errorf("stored tokens = %+v, want the refreshed fields and version %v", stored, first)
	}
	if stored.Scopes != "read" || !stored.ConnectedAt.Equal(connectedAt) {
		t.Errorf("stored Scopes/ConnectedAt = %q/%v, want them preserved like the real store", stored.Scopes, stored.ConnectedAt)
	}

	if _, lateErr := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed("late"), seeded); !errors.Is(lateErr, ports.ErrTokenConflict) {
		t.Errorf("second writer holding the seeded version: error = %v, want ErrTokenConflict", lateErr)
	}
	second, err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed("second"), first)
	if err != nil || !second.After(first) {
		t.Errorf("write with the returned version = %v, %v; want a later version, nil", second, err)
	}
}

// WriteErr takes precedence: nothing is stored or recorded.
func TestMockTokenStore_WriteErrWins(t *testing.T) {
	writeErr := errors.New("firestore unavailable")
	store := &portstest.MockTokenStore{
		Versioned: true,
		WriteErr:  writeErr,
		Tokens:    map[int64]*stravatoken.Data{athleteID: {AccessToken: "old"}},
	}

	version, err := store.WriteTokensIfUnmodified(context.Background(), athleteID, refreshed("new"), time.Time{})
	if !errors.Is(err, writeErr) || !version.IsZero() {
		t.Errorf("WriteTokensIfUnmodified() = %v, %v; want zero version, WriteErr", version, err)
	}
	if store.Tokens[athleteID].AccessToken != "old" || store.WrittenTokens != nil {
		t.Errorf("a failed write changed the store: tokens %+v, written %v", store.Tokens[athleteID], store.WrittenTokens)
	}
}
