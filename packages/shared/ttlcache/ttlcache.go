// Package ttlcache provides a small, bounded, TTL-expiring key/value cache.
//
// It exists to serve read-through caches in front of Firestore lookups that sit
// on a synchronous request path — where the cost of a round-trip (tens of ms) is
// paid on every request for data that changes rarely.
//
// Deliberately minimal:
//
//   - No background goroutine. Expiry is lazy (a stale entry reads as a miss) and
//     eviction happens on insert. A cache keyed by athlete is bounded by the user
//     count, so there is nothing to sweep between writes. Contrast
//     shared/ratelimit, which is keyed by client IP — unbounded by nature, hence
//     its cleanup loop.
//   - No metrics or tracing. Callers know what a hit *means* in their domain and
//     own the span/attribute vocabulary; a cache that stamps spans forces one
//     opinion on every caller. Decorators do that instead.
//   - No singleflight/stampede control. At the scale this serves (single-user
//     today, per-athlete keys), concurrent misses for the same key are rare and
//     the duplicate read is cheaper than the machinery.
//
// The zero value is not usable; construct with New.
package ttlcache

import (
	"sync"
	"time"
)

// DefaultMaxEntries is used when Config.MaxEntries is non-positive.
const DefaultMaxEntries = 1024

// Config configures a Cache.
type Config struct {
	// TTL is how long an entry stays fresh after being written. An entry older
	// than this reads as a miss.
	//
	// Non-positive TTL disables the cache: every Get misses and Put is a no-op.
	// A disabled cache is a valid, useful state — it lets a caller turn caching
	// off from config without a nil check on every call site — so it is not an
	// error.
	TTL time.Duration

	// MaxEntries bounds the map. On insert past the bound, expired entries are
	// purged first; if the cache is still full, the entry nearest expiry is
	// evicted to make room. This is a memory ceiling, not a tuning knob — size it
	// above the expected key cardinality. Non-positive means DefaultMaxEntries.
	MaxEntries int

	// Now overrides the clock. nil means time.Now. Tests inject this to advance
	// past a TTL without sleeping.
	Now func() time.Time
}

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

// Cache is a bounded, TTL-expiring map safe for concurrent use.
type Cache[K comparable, V any] struct {
	mu      sync.RWMutex
	entries map[K]entry[V]
	ttl     time.Duration
	max     int
	now     func() time.Time
	// gen advances on every Invalidate. A read-through caller samples it before
	// consulting the source and hands it back to PutIfUnchanged, which refuses
	// the write if anything was invalidated in between — see PutIfUnchanged.
	gen uint64
}

// New creates a Cache. It cannot fail: a non-positive TTL yields a disabled
// cache (all misses) and a non-positive MaxEntries takes DefaultMaxEntries. Both
// are documented, safe behaviors rather than errors, so callers can wire this
// from config without an error branch or a nil check.
func New[K comparable, V any](cfg Config) *Cache[K, V] {
	maxEntries := cfg.MaxEntries
	if maxEntries <= 0 {
		maxEntries = DefaultMaxEntries
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Cache[K, V]{
		entries: make(map[K]entry[V]),
		ttl:     cfg.TTL,
		max:     maxEntries,
		now:     now,
	}
}

// enabled reports whether the cache stores anything. A non-positive TTL means it
// is off; Get short-circuits to a miss and Put drops the write.
func (c *Cache[K, V]) enabled() bool { return c.ttl > 0 }

// Get returns the cached value for key. The bool is false on a miss OR on an
// expired entry — callers cannot distinguish the two, and shouldn't need to.
//
// Expired entries are left in place rather than deleted, so this can take a read
// lock. Purge happens on insert; the map stays bounded by MaxEntries regardless.
func (c *Cache[K, V]) Get(key K) (V, bool) {
	if !c.enabled() {
		var zero V
		return zero, false
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	e, ok := c.entries[key]
	if !ok || !c.now().Before(e.expiresAt) {
		var zero V
		return zero, false
	}
	return e.value, true
}

// Put stores value under key, replacing any existing entry and restarting its TTL.
func (c *Cache[K, V]) Put(key K, value V) {
	if !c.enabled() {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.entries[key]; !exists && len(c.entries) >= c.max {
		c.evictLocked()
	}
	c.entries[key] = entry[V]{value: value, expiresAt: c.now().Add(c.ttl)}
}

// Invalidate drops key. Safe to call for a key that isn't cached.
//
// This is the correctness hook: a caller that mutates the underlying data must
// invalidate, or the cache will serve a value it knows to be wrong.
func (c *Cache[K, V]) Invalidate(key K) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
	c.gen++
}

// Generation samples the invalidation counter. Pair it with PutIfUnchanged to
// make a read-through safe under concurrency; on its own it means nothing.
func (c *Cache[K, V]) Generation() uint64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.gen
}

// PutIfUnchanged stores value under key only if no Invalidate has run since
// gen was sampled. Reports whether the write happened.
//
// This closes the read-through-then-Put race. A caller that misses, fetches
// from the source, and then Puts can otherwise install a value that a writer
// invalidated while the fetch was in flight — and that stale value then serves
// for a full TTL. Sampling the generation before the fetch and passing it here
// turns that interleaving into a skipped write and a miss on the next read.
//
// The counter is cache-wide rather than per-key, which is deliberate: it makes
// the check allocation-free and unbounded-growth-free, at the cost of an
// unrelated key's invalidation occasionally suppressing a cache fill. That
// error direction is the safe one — a redundant miss, never a stale hit — and
// at this system's key cardinality the false-suppression rate is negligible.
func (c *Cache[K, V]) PutIfUnchanged(key K, value V, gen uint64) bool {
	if !c.enabled() {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.gen != gen {
		return false
	}
	if _, exists := c.entries[key]; !exists && len(c.entries) >= c.max {
		c.evictLocked()
	}
	c.entries[key] = entry[V]{value: value, expiresAt: c.now().Add(c.ttl)}
	return true
}

// Len reports the number of entries held, including expired-but-not-yet-purged
// ones. Intended for tests and diagnostics, not for cache-hit accounting.
func (c *Cache[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

// evictLocked makes room for one entry. Caller must hold the write lock.
//
// Purge expired first — that usually suffices and costs nothing in correctness.
// Only if every entry is live do we evict the one nearest expiry, which is the
// least-useful live entry to keep.
func (c *Cache[K, V]) evictLocked() {
	now := c.now()
	for k, e := range c.entries {
		if !now.Before(e.expiresAt) {
			delete(c.entries, k)
		}
	}
	if len(c.entries) < c.max {
		return
	}

	var oldestKey K
	var oldestAt time.Time
	first := true
	for k, e := range c.entries {
		if first || e.expiresAt.Before(oldestAt) {
			oldestKey, oldestAt, first = k, e.expiresAt, false
		}
	}
	if !first {
		delete(c.entries, oldestKey)
	}
}
