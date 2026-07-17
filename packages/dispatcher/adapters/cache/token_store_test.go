package cache_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/cache"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// countingStore is a ports.TokenStore that records how many times each method was
// called. The shared portstest.MockTokenStore doesn't count reads, and "did this
// reach Firestore?" is the entire question these tests ask.
type countingStore struct {
	mu sync.Mutex

	tokens   map[int64]*stravatoken.Data
	getCalls int
	getErr   error

	writeCalls int
	writeErr   error

	deleteCalls int
	deleteErr   error
}

func newCountingStore(d *stravatoken.Data) *countingStore {
	s := &countingStore{tokens: map[int64]*stravatoken.Data{}}
	if d != nil {
		s.tokens[1] = d
	}
	return s
}

func (s *countingStore) GetTokens(_ context.Context, athleteID int64) (*stravatoken.Data, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++
	if s.getErr != nil {
		return nil, s.getErr
	}
	t, ok := s.tokens[athleteID]
	if !ok {
		return nil, ports.ErrTokenNotFound
	}
	cp := *t
	return &cp, nil
}

func (s *countingStore) WriteTokensIfUnmodified(_ context.Context, athleteID int64, tokens *stravatoken.Data, _ time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writeCalls++
	if s.writeErr != nil {
		return s.writeErr
	}
	cp := *tokens
	s.tokens[athleteID] = &cp
	return nil
}

func (s *countingStore) DeleteTokens(_ context.Context, athleteID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteCalls++
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.tokens, athleteID)
	return nil
}

func (s *countingStore) counts() (get, write, del int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getCalls, s.writeCalls, s.deleteCalls
}

// setTokenDirectly writes to athlete 1 out of band, modeling a write by another
// process (e.g. apigateway re-auth) that this cache cannot observe.
func (s *countingStore) setTokenDirectly(d *stravatoken.Data) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[1] = d
}

var _ ports.TokenStore = (*countingStore)(nil)

func tokenData(access string) *stravatoken.Data {
	return &stravatoken.Data{
		AccessToken:   access,
		RefreshToken:  "refresh",
		ExpiresAt:     time.Now().Add(6 * time.Hour).Unix(),
		LastRefreshed: time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC),
	}
}

func newStore(t *testing.T, inner ports.TokenStore, ttl time.Duration) *cache.TokenStore {
	t.Helper()
	return cache.NewTokenStore(inner, ttl, 0)
}

// The point of the whole exercise: a repeat read inside the TTL must not reach
// Firestore.
func TestSecondGetWithinTTLSkipsTheStore(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	first, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("first GetTokens: %v", err)
	}
	second, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("second GetTokens: %v", err)
	}

	if got, _, _ := inner.counts(); got != 1 {
		t.Errorf("inner GetTokens called %d times, want 1 (second read should hit cache)", got)
	}
	if first.AccessToken != "access-1" || second.AccessToken != "access-1" {
		t.Errorf("tokens = %q/%q, want access-1", first.AccessToken, second.AccessToken)
	}
}

// A cached pointer handed straight back would make every caller a co-owner of
// cache state; one mutation would silently poison every later reader.
func TestGetReturnsACopyCallerCannotCorruptTheCache(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	first, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	first.AccessToken = "MUTATED BY CALLER"

	second, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	if second.AccessToken != "access-1" {
		t.Errorf("cached token = %q, want access-1 — caller mutation leaked into the cache", second.AccessToken)
	}
	if first == second {
		t.Error("two reads returned the same pointer; each read must yield an independent copy")
	}
}

// The acceptance criterion: a refresh must not be shadowed by a stale cached token.
func TestWriteInvalidatesSoNextReadSeesNewTokens(t *testing.T) {
	inner := newCountingStore(tokenData("old-access"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil { // populate the cache
		t.Fatalf("GetTokens: %v", err)
	}
	if err := s.WriteTokensIfUnmodified(ctx, 1, tokenData("new-access"), time.Time{}); err != nil {
		t.Fatalf("WriteTokensIfUnmodified: %v", err)
	}

	got, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens after write: %v", err)
	}
	if got.AccessToken != "new-access" {
		t.Errorf("token = %q, want new-access — the write did not invalidate the cache", got.AccessToken)
	}
}

// The subtle one. On ErrTokenConflict the caller (strava client) re-reads to find
// the winner's tokens. If that read were served from cache it would return the
// value that just LOST the race, and the caller could conflict indefinitely.
func TestWriteConflictInvalidatesSoTheConflictRereadFindsTheWinner(t *testing.T) {
	inner := newCountingStore(tokenData("mine"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil { // cache "mine"
		t.Fatalf("GetTokens: %v", err)
	}

	// Another writer wins the race: the store now holds their tokens and our
	// optimistic write is rejected.
	inner.mu.Lock()
	inner.writeErr = ports.ErrTokenConflict
	inner.mu.Unlock()
	inner.setTokenDirectly(tokenData("winner"))

	err := s.WriteTokensIfUnmodified(ctx, 1, tokenData("mine-refreshed"), time.Time{})
	if !errors.Is(err, ports.ErrTokenConflict) {
		t.Fatalf("WriteTokensIfUnmodified error = %v, want ErrTokenConflict", err)
	}

	got, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("conflict re-read: %v", err)
	}
	if got.AccessToken != "winner" {
		t.Errorf("conflict re-read returned %q, want winner — a cached loser was served", got.AccessToken)
	}
}

// A failed write leaves the store in an unknown state. Unknown is a reason to
// forget, not to keep serving what we happened to have.
func TestTransientWriteFailureStillInvalidates(t *testing.T) {
	inner := newCountingStore(tokenData("cached"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	getsBefore, _, _ := inner.counts()

	inner.mu.Lock()
	inner.writeErr = errors.New("firestore unavailable")
	inner.mu.Unlock()
	if err := s.WriteTokensIfUnmodified(ctx, 1, tokenData("attempted"), time.Time{}); err == nil {
		t.Fatal("expected the write error to propagate")
	}

	if _, err := s.GetTokens(ctx, 1); err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	if getsAfter, _, _ := inner.counts(); getsAfter != getsBefore+1 {
		t.Error("read after a failed write was served from cache; unknown state must invalidate")
	}
}

// A deauth that deletes tokens but leaves them cached would keep the athlete's
// webhooks succeeding against a dead grant for a full TTL.
func TestDeleteInvalidates(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	if err := s.DeleteTokens(ctx, 1); err != nil {
		t.Fatalf("DeleteTokens: %v", err)
	}

	if _, err := s.GetTokens(ctx, 1); !errors.Is(err, ports.ErrTokenNotFound) {
		t.Errorf("GetTokens after delete = %v, want ErrTokenNotFound — deleted tokens were served from cache", err)
	}
}

// Caching a Firestore blip would turn it into a TTL-long outage for the athlete.
func TestErrorsAreNotCached(t *testing.T) {
	inner := newCountingStore(nil)
	inner.getErr = errors.New("firestore unavailable")
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err == nil {
		t.Fatal("expected the read error to propagate")
	}

	// Firestore recovers.
	inner.mu.Lock()
	inner.getErr = nil
	inner.mu.Unlock()
	inner.setTokenDirectly(tokenData("recovered"))

	got, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens after recovery: %v", err)
	}
	if got.AccessToken != "recovered" {
		t.Errorf("token = %q, want recovered", got.AccessToken)
	}
}

// ErrTokenNotFound is an error, so it isn't cached either — a just-authorized
// athlete must not be told "no tokens" for a whole TTL.
func TestNotFoundIsNotCached(t *testing.T) {
	inner := newCountingStore(nil)
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); !errors.Is(err, ports.ErrTokenNotFound) {
		t.Fatalf("GetTokens = %v, want ErrTokenNotFound", err)
	}

	inner.setTokenDirectly(tokenData("just-authorized"))
	got, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens after authorization: %v", err)
	}
	if got.AccessToken != "just-authorized" {
		t.Errorf("token = %q, want just-authorized — a NotFound was cached", got.AccessToken)
	}
}

func TestEntryExpiresAfterTTL(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, 10*time.Millisecond)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil {
		t.Fatalf("GetTokens: %v", err)
	}
	time.Sleep(25 * time.Millisecond)
	if _, err := s.GetTokens(ctx, 1); err != nil {
		t.Fatalf("GetTokens: %v", err)
	}

	if got, _, _ := inner.counts(); got != 2 {
		t.Errorf("inner GetTokens called %d times, want 2 (entry should have expired)", got)
	}
}

func TestWritesAndDeletesAlwaysReachTheInnerStore(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	// The cache must never absorb a mutation — it is a read cache only.
	if err := s.WriteTokensIfUnmodified(ctx, 1, tokenData("x"), time.Time{}); err != nil {
		t.Fatalf("WriteTokensIfUnmodified: %v", err)
	}
	if err := s.DeleteTokens(ctx, 1); err != nil {
		t.Fatalf("DeleteTokens: %v", err)
	}

	_, writes, deletes := inner.counts()
	if writes != 1 {
		t.Errorf("inner writes = %d, want 1", writes)
	}
	if deletes != 1 {
		t.Errorf("inner deletes = %d, want 1", deletes)
	}
}

// cacheAttrs reads the cache.hit / cache.name attributes off a recorded span.
func cacheAttrs(t *testing.T, span sdktrace.ReadOnlySpan) (hit, hasHit bool, name string) {
	t.Helper()
	for _, a := range span.Attributes() {
		switch a.Key {
		case "cache.hit":
			hit, hasHit = a.Value.AsBool(), true
		case "cache.name":
			name = a.Value.AsString()
		}
	}
	return hit, hasHit, name
}

// The acceptance criterion "cache hit/miss is visible in the trace". Without this
// the optimization is a blind spot: a fast span could mean "cached" or "Firestore
// was warm" and nothing distinguishes them.
func TestCacheOutcomeIsStampedOnTheSpan(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")

	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, time.Minute)

	// Each call runs inside its own span, mirroring how the strava client wraps
	// the token read in production.
	for i := 0; i < 2; i++ {
		ctx, span := tracer.Start(context.Background(), "test.get_tokens")
		if _, err := s.GetTokens(ctx, 1); err != nil {
			t.Fatalf("GetTokens: %v", err)
		}
		span.End()
	}

	ended := sr.Ended()
	if len(ended) != 2 {
		t.Fatalf("recorded %d spans, want 2", len(ended))
	}

	// First call: miss (read through to the store).
	hit, hasHit, name := cacheAttrs(t, ended[0])
	if !hasHit {
		t.Fatal("first span carries no cache.hit attribute")
	}
	if hit {
		t.Error("first span reports cache.hit=true; the cache was empty")
	}
	if name != "strava_tokens" {
		t.Errorf("cache.name = %q, want strava_tokens", name)
	}

	// Second call: hit (no Firestore round-trip).
	hit, hasHit, name = cacheAttrs(t, ended[1])
	if !hasHit {
		t.Fatal("second span carries no cache.hit attribute")
	}
	if !hit {
		t.Error("second span reports cache.hit=false; the entry should have been cached")
	}
	if name != "strava_tokens" {
		t.Errorf("cache.name = %q, want strava_tokens", name)
	}
}

// F4: the Strava client invalidates on a rejected refresh via ports.TokenInvalidator.
// After Invalidate, the next read must reach the store (which may hold fresh tokens
// written out-of-process by the apigateway on re-auth).
func TestInvalidateForcesReReadAfterRejectedRefresh(t *testing.T) {
	inner := newCountingStore(tokenData("stale-from-cache"))
	s := newStore(t, inner, time.Minute)
	ctx := context.Background()

	if _, err := s.GetTokens(ctx, 1); err != nil { // cache stale tokens
		t.Fatalf("GetTokens: %v", err)
	}

	// Strava rejected the refresh; the client drops the entry via the interface.
	var inv ports.TokenInvalidator = s
	inv.Invalidate(1)

	// Meanwhile apigateway re-auth wrote fresh tokens to Firestore.
	inner.setTokenDirectly(tokenData("fresh-from-reauth"))

	got, err := s.GetTokens(ctx, 1)
	if err != nil {
		t.Fatalf("GetTokens after invalidate: %v", err)
	}
	if got.AccessToken != "fresh-from-reauth" {
		t.Errorf("token = %q, want fresh-from-reauth — invalidate didn't force a re-read", got.AccessToken)
	}
}

// F1/F7: ttl <= 0 disables the cache (passes through to ttlcache), it is NOT
// rewritten to a default. The kill switch must actually kill.
func TestZeroTTLDisablesTheCache(t *testing.T) {
	inner := newCountingStore(tokenData("access-1"))
	s := newStore(t, inner, 0)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := s.GetTokens(ctx, 1); err != nil {
			t.Fatalf("GetTokens: %v", err)
		}
	}
	if got, _, _ := inner.counts(); got != 3 {
		t.Errorf("inner GetTokens called %d times, want 3 — ttl=0 must disable the cache", got)
	}
}
