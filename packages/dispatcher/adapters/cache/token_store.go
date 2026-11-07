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

// DefaultTokenCacheMaxEntries bounds memory. Keyed by UID/subject pair, so cardinality
// is the user count. A ceiling, not a tuning knob.
const DefaultTokenCacheMaxEntries = 10_000

// TokenStore caches credential values by their captured owner pair. Every hit
// revalidates live ownership; misses read the pair and credentials together.
// Writes invalidate on every outcome, including ambiguous failures and conflicts.
// Generation-checked fills cannot restore an entry invalidated during a read.
// TTL bounds out-of-process credential changes, such as gateway reauthorization.
type TokenStore struct {
	inner ports.TokenStore
	cache *ttlcache.Cache[ports.CredentialOwner, stravatoken.Data]
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
		cache: ttlcache.New[ports.CredentialOwner, stravatoken.Data](ttlcache.Config{TTL: ttl, MaxEntries: maxEntries}),
	}
}

// ValidateOwner always reads through; ownership is never cached.
func (s *TokenStore) ValidateOwner(ctx context.Context, owner ports.CredentialOwner) error {
	//nolint:wrapcheck // Transparent decorator.
	return s.inner.ValidateOwner(ctx, owner)
}

// GetTokens revalidates ownership on hits; misses read both in one snapshot.
//
// The cache stores stravatoken.Data by VALUE and hands out a pointer to a fresh
// copy. Data is flat (no reference fields), so this is a full copy — a caller
// mutating the returned struct cannot corrupt the cached entry. Returning the
// cached pointer directly would make every caller a co-owner of cache state.
//
// Errors are never cached: a Firestore blip must not become a TTL-long outage.
func (s *TokenStore) GetTokens(ctx context.Context, owner ports.CredentialOwner) (*stravatoken.Data, error) {
	span := trace.SpanFromContext(ctx)

	if cached, ok := s.cache.Get(owner); ok {
		if err := s.inner.ValidateOwner(ctx, owner); err != nil {
			s.cache.Invalidate(owner)
			//nolint:wrapcheck // Transparent decorator.
			return nil, err
		}
		stampCache(span, "strava_tokens", true)
		out := cached // copy out of the cache
		return &out, nil
	}

	// Sampled before the fetch: if a writer invalidates while we are in
	// Firestore, PutIfUnchanged refuses the fill rather than installing the
	// value we read a moment too early. Without this the read-through is only
	// race-free at request concurrency 1.
	gen := s.cache.Generation()

	tokens, err := s.inner.GetTokens(ctx, owner)
	stampCache(span, "strava_tokens", false)
	if err != nil {
		//nolint:wrapcheck // Transparent decorator — see the note on the type.
		return nil, err
	}
	if tokens != nil {
		s.cache.PutIfUnchanged(owner, *tokens, gen) // copy into the cache
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
func (s *TokenStore) WriteTokensIfUnmodified(ctx context.Context, owner ports.CredentialOwner, tokens *stravatoken.Data, expectedLastRefreshed time.Time) (time.Time, error) {
	defer s.cache.Invalidate(owner)
	//nolint:wrapcheck // Transparent decorator — see the note on the type.
	return s.inner.WriteTokensIfUnmodified(ctx, owner, tokens, expectedLastRefreshed)
}

// DeleteTokens delegates and drops the cached entry, whatever happens. A deauth
// that deleted the tokens but left them cached would keep the athlete's webhooks
// succeeding against a dead grant for a full TTL.
func (s *TokenStore) DeleteTokens(ctx context.Context, owner ports.CredentialOwner) error {
	defer s.cache.Invalidate(owner)
	//nolint:wrapcheck // Transparent decorator — see the note on the type.
	return s.inner.DeleteTokens(ctx, owner)
}

// Invalidate drops the cached tokens for owner. Implements
// ports.TokenInvalidator. The Strava client calls this when a refresh is rejected:
// the cached tokens are known-bad, and Firestore may already hold fresh ones
// (apigateway re-auth writes the same doc from another process, invisible to this
// cache), so the next read must go through.
func (s *TokenStore) Invalidate(owner ports.CredentialOwner) {
	s.cache.Invalidate(owner)
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
