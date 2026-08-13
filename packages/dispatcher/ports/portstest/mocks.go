// Package portstest provides mock implementations of port interfaces for testing.
//
// All mocks are thread-safe by default. Mutable state (call recordings, tracked
// IDs) is protected by sync.Mutex. Configuration fields (error returns, canned
// responses) are set during test setup before concurrent access and don't need
// locking. Assertions should always happen on the main test goroutine after
// synchronization (e.g., wg.Wait()), never inside spawned goroutines.
package portstest

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// MockPublisher is a mock implementation of the Publisher interface for testing.
// Safe for concurrent use.
type MockPublisher struct {
	mu sync.Mutex
	// PublishErr is the error to return from Publish. Set during test setup.
	PublishErr error
	// FailFirstN makes the first N Publish calls fail with a transient error
	// before succeeding, for modeling a publish that recovers on retry. Failed
	// calls are not recorded in Published. Independent of PublishErr (which fails
	// every call); if both are set, PublishErr wins once FailFirstN is exhausted.
	FailFirstN int
	calls      int
	// Published tracks all successfully published events.
	Published []*generated.EnrichedEvent
}

// Publish implements the mock publisher.
func (m *MockPublisher) Publish(_ context.Context, enriched *generated.EnrichedEvent, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.calls <= m.FailFirstN {
		return fmt.Errorf("mock publish failure %d/%d", m.calls, m.FailFirstN)
	}
	if m.PublishErr != nil {
		return m.PublishErr
	}
	m.Published = append(m.Published, enriched)
	return nil
}

// Close implements the Publisher interface for MockPublisher.
func (m *MockPublisher) Close(_ context.Context) error {
	return nil
}

// PublishedCount returns the number of published events.
func (m *MockPublisher) PublishedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.Published)
}

// PublishedRawActivities returns the raw_activity JSON from each published event,
// parsed as a map for easy assertion. Returns nil entries for events without raw_activity.
func (m *MockPublisher) PublishedRawActivities() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]map[string]any, 0, len(m.Published))
	for _, e := range m.Published {
		if e.RawActivity == nil {
			result = append(result, nil)
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal(e.RawActivity, &parsed); err != nil {
			result = append(result, map[string]any{"_parse_error": err.Error()})
			continue
		}
		result = append(result, parsed)
	}
	return result
}

// MockRawPublisher is a mock implementation of the RawPublisher interface for
// testing. Safe for concurrent use.
type MockRawPublisher struct {
	mu sync.Mutex
	// PublishErr is the error to return from PublishRaw. Set during test setup.
	PublishErr error
	// Published tracks the body of every successfully published message.
	Published [][]byte
}

// PublishRaw implements the mock raw publisher.
func (m *MockRawPublisher) PublishRaw(_ context.Context, data []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.PublishErr == nil {
		m.Published = append(m.Published, data)
	}
	return m.PublishErr
}

// Close implements the RawPublisher interface for MockRawPublisher.
func (m *MockRawPublisher) Close(_ context.Context) error {
	return nil
}

// PublishedCount returns the number of published messages.
func (m *MockRawPublisher) PublishedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.Published)
}

// PublishedBodies returns every published message body parsed as a map, for
// easy assertion. A body that fails to parse yields a single "_parse_error" key.
func (m *MockRawPublisher) PublishedBodies() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]map[string]any, 0, len(m.Published))
	for _, body := range m.Published {
		var parsed map[string]any
		if err := json.Unmarshal(body, &parsed); err != nil {
			result = append(result, map[string]any{"_parse_error": err.Error()})
			continue
		}
		result = append(result, parsed)
	}
	return result
}

// MockSecretProvider is a mock implementation of SecretProvider for testing.
// Already safe for concurrent use (returns fixed values, no mutation).
type MockSecretProvider struct {
	VerifyToken    string
	SubscriptionID int32
	Err            error
}

// GetSecrets implements the SecretProvider interface.
func (m *MockSecretProvider) GetSecrets() (string, int32, error) {
	return m.VerifyToken, m.SubscriptionID, m.Err
}

// MockStravaClient is a mock implementation of StravaClient for testing.
// Safe for concurrent use.
type MockStravaClient struct {
	mu sync.Mutex
	// FetchResult is the raw JSON bytes to return. Set during test setup.
	FetchResult []byte
	// FetchErr is the error to return. Set during test setup.
	FetchErr error
	// FetchDelay simulates a slow Strava. The fetch waits this long before
	// returning, but yields early if the caller's context expires first — so a
	// delay longer than the caller's deadline exercises the timeout path.
	FetchDelay time.Duration
	// FetchedIDs tracks which activity IDs were fetched.
	FetchedIDs []int64
	// FetchedOwnerIDs tracks which owner IDs were passed.
	FetchedOwnerIDs []int64
	// FetchDeadlines records the deadline on each call's context, so a test can
	// assert the caller bounded the fetch rather than handing over its own
	// budget. Zero time means the context carried no deadline.
	FetchDeadlines []time.Time
	// VerifyStatus is returned by VerifyGrant when VerifyErr is nil.
	VerifyStatus ports.GrantStatus
	// VerifyErr is returned by VerifyGrant (overrides VerifyStatus).
	// Set to ports.ErrTokenNotFound to model an athlete with no stored tokens.
	VerifyErr error
	// VerifyDelay simulates a slow verification and respects context expiry.
	VerifyDelay time.Duration
	// VerifyCalledOwnerIDs records the owner IDs VerifyGrant was called with.
	VerifyCalledOwnerIDs []int64
	// VerifyDeadlines records the deadline on each verification context.
	VerifyDeadlines []time.Time
	// VerifyFunc, when set, computes the result dynamically (overriding
	// VerifyStatus/VerifyErr). Use it to model a grant whose status tracks live
	// state — e.g. reading a token store so a deleted token reports as
	// GrantUnknown/ErrTokenNotFound, the way the real client does.
	VerifyFunc func(context.Context, int64) (ports.GrantStatus, error)
}

// VerifyGrant implements the StravaClient interface.
func (m *MockStravaClient) VerifyGrant(ctx context.Context, ownerID int64) (ports.GrantStatus, error) {
	m.mu.Lock()
	m.VerifyCalledOwnerIDs = append(m.VerifyCalledOwnerIDs, ownerID)
	deadline, _ := ctx.Deadline()
	m.VerifyDeadlines = append(m.VerifyDeadlines, deadline)
	delay, status, err, verifyFunc := m.VerifyDelay, m.VerifyStatus, m.VerifyErr, m.VerifyFunc
	m.mu.Unlock()

	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return ports.GrantUnknown, fmt.Errorf("mock grant verification: %w", ctx.Err())
		}
	}
	if verifyFunc != nil {
		return verifyFunc(ctx, ownerID)
	}
	return status, err
}

// VerifyCalledCount returns the number of VerifyGrant calls made.
func (m *MockStravaClient) VerifyCalledCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.VerifyCalledOwnerIDs)
}

// LastVerifyDeadline returns the deadline seen by the most recent verification.
func (m *MockStravaClient) LastVerifyDeadline() (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.VerifyDeadlines) == 0 {
		return time.Time{}, false
	}
	deadline := m.VerifyDeadlines[len(m.VerifyDeadlines)-1]
	return deadline, !deadline.IsZero()
}

// FetchActivity implements the StravaClient interface.
func (m *MockStravaClient) FetchActivity(ctx context.Context, ownerID, activityID int64) ([]byte, error) {
	m.mu.Lock()
	m.FetchedOwnerIDs = append(m.FetchedOwnerIDs, ownerID)
	m.FetchedIDs = append(m.FetchedIDs, activityID)
	deadline, _ := ctx.Deadline()
	m.FetchDeadlines = append(m.FetchDeadlines, deadline)
	delay, result, err := m.FetchDelay, m.FetchResult, m.FetchErr
	m.mu.Unlock()

	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, fmt.Errorf("mock strava fetch: %w", ctx.Err())
		}
	}
	return result, err
}

// LastFetchDeadline returns the deadline seen by the most recent fetch, and
// whether one was set.
func (m *MockStravaClient) LastFetchDeadline() (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.FetchDeadlines) == 0 {
		return time.Time{}, false
	}
	d := m.FetchDeadlines[len(m.FetchDeadlines)-1]
	return d, !d.IsZero()
}

// FetchedCount returns the number of fetch calls made.
func (m *MockStravaClient) FetchedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.FetchedIDs)
}

// MockTokenStore is a mock implementation of TokenStore for testing.
// Safe for concurrent use.
type MockTokenStore struct {
	mu sync.Mutex
	// Tokens maps athlete IDs to their token data. Set during test setup.
	Tokens map[int64]*stravatoken.Data
	// GetErr is returned by GetTokens (overrides Tokens lookup). Set during test setup.
	GetErr error
	// WriteErr is returned by WriteTokensIfUnmodified. Set during test setup.
	WriteErr error
	// WrittenTokens tracks tokens written by WriteTokensIfUnmodified.
	WrittenTokens map[int64]*stravatoken.Data
	// DeleteErr is returned by DeleteTokens. Set during test setup.
	DeleteErr error
	// DeleteRemoves makes a successful DeleteTokens actually drop the entry from
	// Tokens, so a later GetTokens reports ErrTokenNotFound. Off by default
	// (delete only records the call); turn it on to model the real store's state
	// transition, e.g. for deauth replay/retry regressions.
	DeleteRemoves bool
	// DeletedAthleteIDs tracks which athlete IDs had tokens deleted.
	DeletedAthleteIDs []int64
}

// GetTokens implements the TokenStore interface.
func (m *MockTokenStore) GetTokens(_ context.Context, athleteID int64) (*stravatoken.Data, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.GetErr != nil {
		return nil, m.GetErr
	}
	tokens, ok := m.Tokens[athleteID]
	if !ok {
		return nil, ports.ErrTokenNotFound
	}
	return tokens, nil
}

// WriteTokensIfUnmodified implements the TokenStore interface with optimistic concurrency.
func (m *MockTokenStore) WriteTokensIfUnmodified(_ context.Context, athleteID int64, tokens *stravatoken.Data, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.WriteErr != nil {
		return m.WriteErr
	}
	if m.WrittenTokens == nil {
		m.WrittenTokens = make(map[int64]*stravatoken.Data)
	}
	m.WrittenTokens[athleteID] = tokens
	return nil
}

// DeleteTokens implements the TokenStore interface.
func (m *MockTokenStore) DeleteTokens(_ context.Context, athleteID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.DeletedAthleteIDs = append(m.DeletedAthleteIDs, athleteID)
	if m.DeleteErr != nil {
		return m.DeleteErr
	}
	if m.DeleteRemoves {
		delete(m.Tokens, athleteID)
	}
	return nil
}

// DeletedCount returns the number of delete calls made.
func (m *MockTokenStore) DeletedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.DeletedAthleteIDs)
}

// MockAllowlist is a mock implementation of allowlist.Checker for testing.
// The zero value denies (Allowed=false); construct with
// NewAllowAllMockAllowlist() for the common allowed=true case, or set
// Allowed/Err explicitly. Safe for concurrent use.
type MockAllowlist struct {
	mu sync.Mutex
	// Allowed is the answer returned by IsAllowed when Err is nil.
	Allowed bool
	// Err is returned by IsAllowed (overrides Allowed). Set during test setup.
	Err error
	// CalledWith records the athlete IDs IsAllowed was called with.
	CalledWith []string
	// InvalidatedWith records the athlete IDs Invalidate was called with.
	InvalidatedWith []string
}

// NewAllowAllMockAllowlist returns a MockAllowlist preconfigured to allow
// every athlete. Most tests want this default; non-allowlist concerns are
// being exercised.
func NewAllowAllMockAllowlist() *MockAllowlist {
	return &MockAllowlist{Allowed: true}
}

// IsAllowed implements allowlist.Checker.
func (m *MockAllowlist) IsAllowed(_ context.Context, athleteID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CalledWith = append(m.CalledWith, athleteID)
	if m.Err != nil {
		return false, m.Err
	}
	return m.Allowed, nil
}

// CalledCount returns the number of IsAllowed calls made.
func (m *MockAllowlist) CalledCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.CalledWith)
}

// Invalidate records the athlete ID, letting MockAllowlist satisfy
// allowlist.Invalidator so the deauth-invalidation wiring is testable.
func (m *MockAllowlist) Invalidate(athleteID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.InvalidatedWith = append(m.InvalidatedWith, athleteID)
}
