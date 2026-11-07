package cache_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

func TestTokenCacheSeparatesUIDAndSubjectAndRevalidatesHits(t *testing.T) {
	ctx := context.Background()
	a := ports.CredentialOwner{UID: "app-a", Subject: 123}
	b := ports.CredentialOwner{UID: "app-b", Subject: 123}
	c := ports.CredentialOwner{UID: "app-a", Subject: 456}
	inner := newCountingStore(nil)
	inner.tokens[a], inner.tokens[b], inner.tokens[c] = tokenData("a"), tokenData("b"), tokenData("c")
	store := newStore(t, inner, time.Hour)
	for _, owner := range []ports.CredentialOwner{a, b, c, a, b, c} {
		got, err := store.GetTokens(ctx, owner)
		if err != nil || got.AccessToken != inner.tokens[owner].AccessToken {
			t.Fatalf("owner=%+v tokens=%v err=%v", owner, got, err)
		}
	}
	if get, _, _ := inner.counts(); get != 3 || !slices.Equal(inner.validated, []ports.CredentialOwner{a, b, c}) {
		t.Fatalf("reads=%d validations=%v", get, inner.validated)
	}
	for _, err := range []error{activityconnection.ErrConflict, activityconnection.ErrNotFound, context.DeadlineExceeded} {
		inner.validateErr = err
		got, getErr := store.GetTokens(ctx, a)
		if !errors.Is(getErr, err) || got != nil || errors.Is(getErr, ports.ErrTokenNotFound) {
			t.Fatalf("cached credentials escaped failed ownership check: %v %v", got, getErr)
		}
		inner.validateErr = nil
		// A failure evicts the old entry; a later read must go through.
		inner.tokens[a] = tokenData("new-a")
		got, getErr = store.GetTokens(ctx, a)
		if getErr != nil || got.AccessToken != "new-a" {
			t.Fatalf("failed validation did not evict: %v %v", got, getErr)
		}
	}
	if err := store.ValidateOwner(ctx, a); err != nil {
		t.Fatal(err)
	}
}
