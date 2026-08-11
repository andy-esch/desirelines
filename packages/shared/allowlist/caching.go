package allowlist

import (
	"context"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/ttlcache"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// DefaultCacheMaxEntries bounds the cache's memory. Keys are athlete IDs, so
// cardinality is the user count — 1 today, and this survives four orders of
// magnitude of growth before evicting. Sized as a ceiling against a key-explosion
// bug (an unexpected id shape), not as a tuning knob.
const DefaultCacheMaxEntries = 10_000

// CachingChecker decorates a Checker with a bounded TTL cache.
//
// Intended for callers that check the same athlete repeatedly on a latency-
// sensitive path — the dispatcher hits the allowlist on every inbound webhook,
// where the Firestore round-trip is ~45ms of serial time before Strava can even
// be called.
//
// NOT a blanket win. The apigateway deliberately does not use this: its only
// IsAllowed call gates the OAuth callback, which runs once per sign-in. Caching
// there would buy nothing measurable while widening the window in which a
// just-revoked athlete could complete a sign-in. Cache where the read repeats,
// not everywhere the interface appears.
//
// Only positive AND negative decisions are cached; errors never are (see IsAllowed).
//
// Errors from the inner Checker are returned VERBATIM, never wrapped. The Checker
// contract makes callers branch on them (fail-closed → 500 → Strava retries), and
// FirestoreChecker already wraps with real context ("firestore get allowlist/%s").
// A "cached checker:" layer would add no information and would sit in the middle
// of every allowlist error message.
type CachingChecker struct {
	inner Checker
	cache *ttlcache.Cache[string, bool]
}

// Invalidator is optionally implemented by a Checker that caches decisions. A
// caller that mutates allowlist state — the dispatcher, when it processes a
// deauth — type-asserts to it and drops the entry, so the change is reflected
// within Firestore-propagation latency instead of after a full TTL. A non-caching
// Checker doesn't implement it, so the assertion no-ops.
type Invalidator interface {
	Invalidate(athleteID string)
}

// Compile-time checks.
var (
	_ Checker     = (*CachingChecker)(nil)
	_ Invalidator = (*CachingChecker)(nil)
)

// NewCachingChecker wraps inner with a TTL cache.
//
// ttl <= 0 yields a DISABLED cache (every check passes through to inner), matching
// ttlcache's own semantics — it is NOT rewritten to a default. Applying the
// unset-default belongs to the caller's config layer, which alone can distinguish
// "unset" from an explicit "0" (disable). maxEntries <= 0 still takes the package
// default (a memory cap, not a behavior toggle).
func NewCachingChecker(inner Checker, ttl time.Duration, maxEntries int) *CachingChecker {
	if maxEntries <= 0 {
		maxEntries = DefaultCacheMaxEntries
	}
	return &CachingChecker{
		inner: inner,
		cache: ttlcache.New[string, bool](ttlcache.Config{TTL: ttl, MaxEntries: maxEntries}),
	}
}

// IsAllowed returns a cached allow when fresh, otherwise delegates.
//
// Only POSITIVE decisions are cached. This is deliberate, and it is what keeps
// the cache safe:
//
//   - "allowed" is the hot, stable fact — it's the single user on every webhook,
//     and it changes only on deauth, which the dispatcher invalidates explicitly.
//   - A cached "not allowed" would be a data-loss hazard: the handler 200-acks a
//     rejected event (no Strava retry, stray is un-alerted), so a stale false
//     silently drops a just-re-authorized athlete's activity for up to a TTL, with
//     no signal. Re-auth is an apigateway write this cache can't see, so there's no
//     clean invalidation for it — the right answer is to not cache the negative and
//     fail fresh. Strays are rare (cross-env / post-deauth grants), so the Firestore
//     read they now always pay is not on any hot path.
//
// Errors are never cached either: a fail-closed error becomes a 500 → Strava
// retries, and a cached error would poison every retry in the window.
//
// Stamps cache.hit on the active span so a hit is visible in the trace both as
// "span present, no Firestore child" and as an explicit attribute — the
// optimization can't silently become a blind spot.
func (c *CachingChecker) IsAllowed(ctx context.Context, athleteID string) (bool, error) {
	span := trace.SpanFromContext(ctx)

	if _, ok := c.cache.Get(athleteID); ok {
		// Only "allowed" is ever stored, so a hit is unconditionally true.
		stampCacheHit(span, true)
		return true, nil
	}

	// Sampled before the fetch — see PutIfUnchanged. A deauth invalidates this
	// entry out of band; without the guard a straggler read-through could
	// reinstall allowed=true for a full TTL after the revoke.
	gen := c.cache.Generation()

	allowed, err := c.inner.IsAllowed(ctx, athleteID)
	stampCacheHit(span, false)
	if err != nil {
		//nolint:wrapcheck // Transparent decorator — see the note on the type.
		return false, err
	}

	if allowed {
		c.cache.PutIfUnchanged(athleteID, true, gen)
	}
	return allowed, nil
}

// stampCacheHit records the cache outcome on the active span, so a hit is visible
// in the trace as an attribute and not merely as an absent Firestore child span.
func stampCacheHit(span trace.Span, hit bool) {
	span.SetAttributes(
		attribute.Bool("cache.hit", hit),
		attribute.String("cache.name", "allowlist"),
	)
}

// Invalidate drops the cached decision for athleteID, so the next IsAllowed
// re-reads Firestore.
//
// This IS wired: the dispatcher calls it when it processes a deauth (which is
// followed, out of process, by the deletion service removing the allowlist doc).
// Without it a straggler webhook arriving after deauth would read a cached
// allowed=true, find the tokens already deleted, and trip the HIGH
// webhook_owner_check_orphan alert — turning the deliberately-quiet stray path
// loud for up to a full TTL. Invalidating here keeps the false-orphan window at
// the inherent Firestore-propagation latency, cache or no cache.
func (c *CachingChecker) Invalidate(athleteID string) {
	c.cache.Invalidate(athleteID)
}
