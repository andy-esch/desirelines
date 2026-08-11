package ttlcache_test

import (
	"sync"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/ttlcache"
)

// fakeClock lets a test cross a TTL boundary without sleeping.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newTestCache(clk *fakeClock, ttl time.Duration, maxEntries int) *ttlcache.Cache[string, int] {
	return ttlcache.New[string, int](ttlcache.Config{TTL: ttl, MaxEntries: maxEntries, Now: clk.Now})
}

func TestGetMissOnUnknownKey(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 10)
	if _, ok := c.Get("nope"); ok {
		t.Error("Get on an empty cache returned a hit")
	}
}

func TestPutThenGetHits(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 10)
	c.Put("a", 42)
	got, ok := c.Get("a")
	if !ok {
		t.Fatal("Get after Put missed")
	}
	if got != 42 {
		t.Errorf("Get = %d, want 42", got)
	}
}

func TestEntryExpiresAfterTTL(t *testing.T) {
	clk := newClock()
	c := newTestCache(clk, time.Minute, 10)
	c.Put("a", 1)

	// Just inside the window: still a hit.
	clk.Advance(59 * time.Second)
	if _, ok := c.Get("a"); !ok {
		t.Error("entry expired before its TTL elapsed")
	}

	// Exactly at the boundary: expired. TTL is the max age, not a grace period.
	clk.Advance(time.Second)
	if _, ok := c.Get("a"); ok {
		t.Error("entry still hit at exactly TTL; boundary should expire")
	}
}

func TestPutRestartsTTL(t *testing.T) {
	clk := newClock()
	c := newTestCache(clk, time.Minute, 10)
	c.Put("a", 1)
	clk.Advance(50 * time.Second)
	c.Put("a", 2) // restarts the clock for this key
	clk.Advance(50 * time.Second)

	got, ok := c.Get("a")
	if !ok {
		t.Fatal("re-Put entry expired on the original TTL")
	}
	if got != 2 {
		t.Errorf("Get = %d, want 2 (the re-Put value)", got)
	}
}

func TestInvalidateDropsEntry(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 10)
	c.Put("a", 1)
	c.Invalidate("a")
	if _, ok := c.Get("a"); ok {
		t.Error("Get hit after Invalidate")
	}
}

func TestInvalidateUnknownKeyIsSafe(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 10)
	c.Invalidate("never-cached") // must not panic
	if c.Len() != 0 {
		t.Errorf("Len = %d, want 0", c.Len())
	}
}

func TestCacheIsBoundedByMaxEntries(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 3)
	for _, k := range []string{"a", "b", "c", "d", "e"} {
		c.Put(k, 1)
	}
	if got := c.Len(); got > 3 {
		t.Errorf("Len = %d, want <= 3 (MaxEntries must bound the map)", got)
	}
}

func TestEvictionPrefersExpiredOverLive(t *testing.T) {
	clk := newClock()
	c := newTestCache(clk, time.Minute, 2)

	c.Put("stale", 1)
	clk.Advance(2 * time.Minute) // "stale" is now expired
	c.Put("live", 2)             // fresh
	c.Put("new", 3)              // at cap → must reclaim "stale", not "live"

	if _, ok := c.Get("live"); !ok {
		t.Error("a live entry was evicted while an expired one remained")
	}
	if _, ok := c.Get("new"); !ok {
		t.Error("the just-inserted entry is missing")
	}
}

func TestEvictionFallsBackToNearestExpiryWhenAllLive(t *testing.T) {
	clk := newClock()
	c := newTestCache(clk, time.Minute, 2)

	c.Put("oldest", 1) // expires first
	clk.Advance(10 * time.Second)
	c.Put("newer", 2)
	clk.Advance(10 * time.Second)
	c.Put("newest", 3) // at cap, nothing expired → evict "oldest"

	if _, ok := c.Get("oldest"); ok {
		t.Error("expected the entry nearest expiry to be evicted")
	}
	for _, k := range []string{"newer", "newest"} {
		if _, ok := c.Get(k); !ok {
			t.Errorf("%q was evicted; expected it to survive", k)
		}
	}
}

func TestOverwriteAtCapacityDoesNotEvict(t *testing.T) {
	c := newTestCache(newClock(), time.Minute, 2)
	c.Put("a", 1)
	c.Put("b", 2)
	c.Put("a", 99) // replaces, doesn't grow — must not evict "b"

	if _, ok := c.Get("b"); !ok {
		t.Error("overwriting an existing key at capacity evicted another entry")
	}
	if got, _ := c.Get("a"); got != 99 {
		t.Errorf("Get(a) = %d, want 99", got)
	}
}

func TestNonPositiveTTLDisablesTheCache(t *testing.T) {
	// A disabled cache is a supported state, not a misconfiguration: it lets a
	// caller turn caching off from config without nil-checking every call site.
	clk := newClock()
	c := newTestCache(clk, 0, 10)
	c.Put("a", 1)
	if _, ok := c.Get("a"); ok {
		t.Error("Get hit on a TTL<=0 cache; it should be disabled")
	}
	if c.Len() != 0 {
		t.Errorf("Len = %d, want 0 — Put should no-op when disabled", c.Len())
	}
}

func TestNonPositiveMaxEntriesFallsBackToDefault(t *testing.T) {
	clk := newClock()
	c := newTestCache(clk, time.Minute, 0)
	c.Put("a", 1)
	if _, ok := c.Get("a"); !ok {
		t.Error("cache with MaxEntries<=0 should still work (default bound applies)")
	}
}

func TestConcurrentAccessIsRaceFree(t *testing.T) {
	// Meaningful under `go test -race`, which CI runs.
	c := newTestCache(newClock(), time.Minute, 64)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				c.Put("k", j)
				c.Get("k")
				c.Invalidate("k")
				c.Len()
			}
		}()
	}
	wg.Wait()
}

// TestPutIfUnchanged_RefusesFillInvalidatedMidFetch pins the read-through race
// the generation guard exists to close: a caller misses, goes to the source,
// and a writer invalidates while that fetch is in flight. Installing the
// now-stale value would serve it for a full TTL. The guard must turn that into
// a skipped write.
func TestPutIfUnchanged_RefusesFillInvalidatedMidFetch(t *testing.T) {
	c := ttlcache.New[string, int](ttlcache.Config{TTL: time.Minute})

	gen := c.Generation() // caller samples before its (simulated) fetch
	c.Invalidate("k")     // a writer lands mid-fetch

	if c.PutIfUnchanged("k", 1, gen) {
		t.Error("PutIfUnchanged wrote a value invalidated mid-fetch; the entry would serve stale for a full TTL")
	}
	if _, ok := c.Get("k"); ok {
		t.Error("cache holds an entry it should have refused")
	}
}

// The guard must not block the ordinary path, or every read-through becomes a
// permanent miss.
func TestPutIfUnchanged_AllowsUncontendedFill(t *testing.T) {
	c := ttlcache.New[string, int](ttlcache.Config{TTL: time.Minute})

	gen := c.Generation()
	if !c.PutIfUnchanged("k", 1, gen) {
		t.Fatal("PutIfUnchanged refused an uncontended fill")
	}
	got, ok := c.Get("k")
	if !ok || got != 1 {
		t.Errorf("Get = (%v, %v), want (1, true)", got, ok)
	}
}

// Invalidating an unrelated key also bumps the counter, so a fill can be
// suppressed by someone else's write. Documented as the deliberate cost of a
// cache-wide counter: the error direction is a redundant miss, never a stale
// hit.
func TestPutIfUnchanged_UnrelatedInvalidateSuppressesFill(t *testing.T) {
	c := ttlcache.New[string, int](ttlcache.Config{TTL: time.Minute})

	gen := c.Generation()
	c.Invalidate("other")

	if c.PutIfUnchanged("k", 1, gen) {
		t.Error("expected the cache-wide counter to suppress this fill")
	}
	// And the next attempt, sampling a fresh generation, succeeds.
	if !c.PutIfUnchanged("k", 1, c.Generation()) {
		t.Error("a fresh generation must allow the fill")
	}
}
