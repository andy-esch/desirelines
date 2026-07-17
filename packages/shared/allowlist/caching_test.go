package allowlist_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/allowlist"
)

// countingChecker records how many times the underlying check ran — "did this
// reach Firestore?" is the whole question here.
type countingChecker struct {
	mu      sync.Mutex
	calls   int
	allowed bool
	err     error
}

func (c *countingChecker) IsAllowed(_ context.Context, _ string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	return c.allowed, c.err
}

func (c *countingChecker) callCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

// setAllowed changes the decision and clears any configured error — i.e. models
// "the backend recovered and now says this".
func (c *countingChecker) setAllowed(allowed bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.allowed, c.err = allowed, nil
}

var _ allowlist.Checker = (*countingChecker)(nil)

func TestSecondCheckWithinTTLSkipsTheChecker(t *testing.T) {
	inner := &countingChecker{allowed: true}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		allowed, err := c.IsAllowed(ctx, "123")
		if err != nil {
			t.Fatalf("IsAllowed: %v", err)
		}
		if !allowed {
			t.Fatal("IsAllowed = false, want true")
		}
	}
	if got := inner.callCount(); got != 1 {
		t.Errorf("inner called %d times, want 1 — repeat checks should hit the cache", got)
	}
}

// Negative decisions are NOT cached — every "not allowed" re-reads Firestore.
// A cached false is a data-loss hazard: the handler 200-acks a rejected event, so
// a stale false would silently drop a just-re-authorized athlete's activity for a
// full TTL. Strays are rare, so failing fresh here costs nothing on any hot path.
func TestNegativeDecisionsAreNotCached(t *testing.T) {
	inner := &countingChecker{allowed: false}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		allowed, err := c.IsAllowed(ctx, "123")
		if err != nil {
			t.Fatalf("IsAllowed: %v", err)
		}
		if allowed {
			t.Fatal("IsAllowed = true, want false")
		}
	}
	if got := inner.callCount(); got != 3 {
		t.Errorf("inner called %d times, want 3 — negatives must not be cached", got)
	}
}

// A just-added athlete must take effect immediately, not after a TTL — a direct
// consequence of not caching the earlier "not allowed" reads.
func TestNewlyAddedAthleteIsNotRejectedByAStaleNegative(t *testing.T) {
	inner := &countingChecker{allowed: false}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	if allowed, err := c.IsAllowed(ctx, "123"); err != nil || allowed {
		t.Fatalf("precondition: expected (false, nil), got (%v, %v)", allowed, err)
	}
	inner.setAllowed(true) // admin adds the athlete
	if allowed, err := c.IsAllowed(ctx, "123"); err != nil || !allowed {
		t.Errorf("IsAllowed = %v, %v; want true, nil — a stale negative was served", allowed, err)
	}
}

// Deauth invalidation: after the dispatcher drops a cached allow, the next check
// re-reads Firestore (where the deletion service has since removed the doc).
func TestInvalidateAfterAllowedForcesReRead(t *testing.T) {
	inner := &countingChecker{allowed: true}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	if allowed, err := c.IsAllowed(ctx, "123"); err != nil || !allowed { // cache the allow
		t.Fatalf("precondition: expected (true, nil), got (%v, %v)", allowed, err)
	}
	c.Invalidate("123")     // dispatcher processes deauth
	inner.setAllowed(false) // deletion service removed the doc

	allowed, err := c.IsAllowed(ctx, "123")
	if err != nil {
		t.Fatalf("IsAllowed: %v", err)
	}
	if allowed {
		t.Error("served a cached allow after Invalidate; deauth must force a re-read")
	}
}

// Callers fail CLOSED on an allowlist error (dispatcher returns 500 so Strava
// retries). Caching an error would turn a blip into a TTL-long outage AND poison
// every retry inside the window — the retries would never reach Firestore.
func TestErrorsAreNotCached(t *testing.T) {
	inner := &countingChecker{allowed: false, err: errors.New("firestore unavailable")}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	if _, err := c.IsAllowed(ctx, "123"); err == nil {
		t.Fatal("expected the error to propagate")
	}

	inner.setAllowed(true) // Firestore recovers
	allowed, err := c.IsAllowed(ctx, "123")
	if err != nil {
		t.Fatalf("IsAllowed after recovery: %v", err)
	}
	if !allowed {
		t.Error("IsAllowed = false; the retry was served a cached error instead of re-reading")
	}
	if got := inner.callCount(); got != 2 {
		t.Errorf("inner called %d times, want 2", got)
	}
}

func TestDecisionsAreKeyedPerAthlete(t *testing.T) {
	inner := &countingChecker{allowed: true}
	c := allowlist.NewCachingChecker(inner, time.Minute, 10)
	ctx := context.Background()

	if _, err := c.IsAllowed(ctx, "111"); err != nil {
		t.Fatal(err)
	}
	inner.setAllowed(false)
	allowed, err := c.IsAllowed(ctx, "222")
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Error("athlete 222 was served athlete 111's cached decision")
	}
}

func TestEntryExpiresAfterTTL(t *testing.T) {
	inner := &countingChecker{allowed: true}
	c := allowlist.NewCachingChecker(inner, 10*time.Millisecond, 10)
	ctx := context.Background()

	if _, err := c.IsAllowed(ctx, "123"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(25 * time.Millisecond)

	// An athlete removed from the allowlist takes effect within one TTL.
	inner.setAllowed(false)
	allowed, err := c.IsAllowed(ctx, "123")
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Error("removal did not take effect after the TTL elapsed")
	}
	if got := inner.callCount(); got != 2 {
		t.Errorf("inner called %d times, want 2", got)
	}
}

// ttl <= 0 DISABLES the cache (it is not rewritten to a default). Every check
// passes through — this is the kill switch, and it must actually kill.
func TestZeroTTLDisablesTheCache(t *testing.T) {
	inner := &countingChecker{allowed: true}
	c := allowlist.NewCachingChecker(inner, 0, 0)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := c.IsAllowed(ctx, "123"); err != nil {
			t.Fatalf("IsAllowed: %v", err)
		}
	}
	if got := inner.callCount(); got != 3 {
		t.Errorf("inner called %d times, want 3 — ttl=0 must disable the cache, not default it", got)
	}
}
