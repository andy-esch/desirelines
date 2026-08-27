// Package cache provides caching decorators for the dispatcher's outbound ports.
//
// These sit on the synchronous webhook path — the work that must finish before
// the dispatcher ACKs Strava (which expects a response within ~2s) — where a
// Firestore round-trip is tens of milliseconds of pure serial latency.
package cache

import (
	"context"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"github.com/andy-esch/desirelines/packages/shared/ttlcache"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// DefaultTokenCacheMaxEntries bounds memory. Keyed by athlete ID, so cardinality
// is the user count. A ceiling, not a tuning knob.
const DefaultTokenCacheMaxEntries = 10_000

// TokenStore decorates a ports.TokenStore with a bounded TTL cache, removing the
// Firestore GetTokens round-trip (~42ms) from the webhook hot path.
//
// Tokens are sensitive, rotated data, so this caches on invalidation rather than
// on hope: every write path drops the entry, whatever its outcome. The cache is
// never the source of truth for a write — WriteTokensIfUnmodified's optimistic
// concurrency still runs against Firestore, so a stale cached LastRefreshed
// produces a conflict (which invalidates and re-reads), never a lost update.
//
// The TTL (config.DefaultTokenCacheTTL when unset) is a backstop, not the primary
// consistency mechanism: local mutations invalidate directly, and the Strava
// client invalidates on a rejected refresh. The one case none of those covers is a
// write to the same Firestore doc by a DIFFERENT process — the apigateway's OAuth
// callback on re-auth, which this in-process cache cannot see — and the TTL bounds
// how long such a write can be shadowed.
//
// NOTE (concurrency): the read-through is safe under concurrency: GetTokens samples the cache
// generation before consulting Firestore and fills via PutIfUnchanged, so a Put
// that would land after a concurrent mutation's Invalidate is refused rather
// than re-caching a stale value for a full TTL. This used to be the reason
// max_instance_request_concurrency was pinned to 1; it no longer is.
type TokenStore struct {
	inner ports.TokenStore
	cache *ttlcache.Cache[int64, stravatoken.Data]
}

// Errors from the inner store are returned VERBATIM, never wrapped. Callers match
// sentinels on them (ports.ErrTokenNotFound → orphan/ack-200,
// ports.ErrTokenConflict → re-read the winner) and the strava client wraps them
// with real context at its own call sites. A "cached token store:" layer would add
// no information and would sit in the middle of every token error message.
//
// Compile-time checks.
var (
	_ ports.TokenStore       = (*TokenStore)(nil)
	_ ports.TokenInvalidator = (*TokenStore)(nil)
)

// NewTokenStore wraps inner with a TTL cache.
//
// ttl <= 0 yields a DISABLED cache (every read passes through to inner), matching
// ttlcache's own semantics — it is NOT rewritten to a default. The 5m default for
// an *unset* config value belongs at the config layer, which alone can tell "unset"
// (→ default) from an explicit "0" (→ disable). Rewriting 0→default here is what
// made the documented kill switch silently a no-op. maxEntries <= 0 still takes
// the package default (a cap, not a behavior toggle).
func NewTokenStore(inner ports.TokenStore, ttl time.Duration, maxEntries int) *TokenStore {
	if maxEntries <= 0 {
		maxEntries = DefaultTokenCacheMaxEntries
	}
	return &TokenStore{
		inner: inner,
		cache: ttlcache.New[int64, stravatoken.Data](ttlcache.Config{TTL: ttl, MaxEntries: maxEntries}),
	}
}

// GetTokens returns cached tokens when fresh, otherwise reads through.
//
// The cache stores stravatoken.Data by VALUE and hands out a pointer to a fresh
// copy. Data is flat (no reference fields), so this is a full copy — a caller
// mutating the returned struct cannot corrupt the cached entry. Returning the
// cached pointer directly would make every caller a co-owner of cache state.
//
// Errors are never cached: a Firestore blip must not become a TTL-long outage.
func (s *TokenStore) GetTokens(ctx context.Context, athleteID int64) (*stravatoken.Data, error) {
	span := trace.SpanFromContext(ctx)

	if cached, ok := s.cache.Get(athleteID); ok {
		stampCache(span, "strava_tokens", true)
		out := cached // copy out of the cache
		return &out, nil
	}

	// Sampled before the fetch: if a writer invalidates while we are in
	// Firestore, PutIfUnchanged refuses the fill rather than installing the
	// value we read a moment too early. Without this the read-through is only
	// race-free at request concurrency 1.
	gen := s.cache.Generation()

	tokens, err := s.inner.GetTokens(ctx, athleteID)
	stampCache(span, "strava_tokens", false)
	if err != nil {
		//nolint:wrapcheck // Transparent decorator — see the note on the type.
		return nil, err
	}
	if tokens != nil {
		s.cache.PutIfUnchanged(athleteID, *tokens, gen) // copy into the cache
	}
	return tokens, nil
}

// WriteTokensIfUnmodified delegates and drops the cached entry, whatever happens.
//
// Invalidating unconditionally (rather than only on success) is what makes the
// cache safe on every branch:
//
//   - success — the tokens we hold are now stale by definition.
//   - ErrTokenConflict — another writer won. The caller's recovery is to re-read
//     the winner's tokens; that read MUST bypass the cache or it would get the
//     value that just lost, and could conflict forever. Dropping the entry here
//     turns that re-read into a guaranteed miss.
//   - ErrTokenNotFound — the tokens were deleted mid-refresh (deauth race).
//   - transient failure — the write may or may not have landed. Unknown state is
//     a reason to forget, not to keep.
func (s *TokenStore) WriteTokensIfUnmodified(ctx context.Context, athleteID int64, tokens *stravatoken.Data, expectedLastRefreshed time.Time) error {
	defer s.cache.Invalidate(athleteID)
	//nolint:wrapcheck // Transparent decorator — see the note on the type.
	return s.inner.WriteTokensIfUnmodified(ctx, athleteID, tokens, expectedLastRefreshed)
}

// DeleteTokens delegates and drops the cached entry, whatever happens. A deauth
// that deleted the tokens but left them cached would keep the athlete's webhooks
// succeeding against a dead grant for a full TTL.
func (s *TokenStore) DeleteTokens(ctx context.Context, athleteID int64) error {
	defer s.cache.Invalidate(athleteID)
	//nolint:wrapcheck // Transparent decorator — see the note on the type.
	return s.inner.DeleteTokens(ctx, athleteID)
}

// Invalidate drops the cached tokens for athleteID. Implements
// ports.TokenInvalidator. The Strava client calls this when a refresh is rejected:
// the cached tokens are known-bad, and Firestore may already hold fresh ones
// (apigateway re-auth writes the same doc from another process, invisible to this
// cache), so the next read must go through.
func (s *TokenStore) Invalidate(athleteID int64) {
	s.cache.Invalidate(athleteID)
}

// stampCache records the cache outcome on the active span, so a hit is visible in
// the trace as an attribute and not merely as an absent Firestore child span.
// Without it, "fast because cached" and "fast because Firestore was warm" look
// identical, and the optimization becomes a blind spot.
func stampCache(span trace.Span, name string, hit bool) {
	span.SetAttributes(
		attribute.Bool("cache.hit", hit),
		attribute.String("cache.name", name),
	)
}
