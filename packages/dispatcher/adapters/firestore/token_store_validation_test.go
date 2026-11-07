package firestore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

func TestInvalidCredentialInputsNeverReachFirestore(t *testing.T) {
	noop := otel.NoopProviders()
	histogram, err := noop.Meter.Float64Histogram("test")
	if err != nil {
		t.Fatal(err)
	}
	// A nil client makes accidental I/O fail immediately, without cloud access.
	store := NewTokenStore(nil, histogram, noop.Tracer)
	ctx := context.Background()
	for _, owner := range []ports.CredentialOwner{{}, {UID: "unsafe/path", Subject: 123}, {UID: "uid", Subject: -1}} {
		_, readErr := store.GetTokens(ctx, owner)
		_, writeErr := store.WriteTokensIfUnmodified(ctx, owner, nil, time.Time{})
		for _, got := range []error{store.ValidateOwner(ctx, owner), readErr, writeErr, store.DeleteTokens(ctx, owner)} {
			if !errors.Is(got, activityconnection.ErrConflict) {
				t.Fatalf("invalid owner accepted: %+v %v", owner, got)
			}
		}
	}
	owner := ports.CredentialOwner{UID: "valid-uid", Subject: 123}
	for _, tokens := range []*stravatoken.Data{nil, {}, {AccessToken: "access"}} {
		version, got := store.WriteTokensIfUnmodified(ctx, owner, tokens, time.Time{})
		if !errors.Is(got, stravatoken.ErrIncompleteTokens) || !version.IsZero() {
			t.Fatalf("invalid credentials accepted: %v %v", version, got)
		}
	}
}
