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
	// Published tracks all successfully published events.
	Published []*generated.EnrichedEvent
}

// Publish implements the mock publisher.
func (m *MockPublisher) Publish(_ context.Context, enriched *generated.EnrichedEvent, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.PublishErr == nil {
		m.Published = append(m.Published, enriched)
	}
	return m.PublishErr
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
	// FetchedIDs tracks which activity IDs were fetched.
	FetchedIDs []int64
	// FetchedOwnerIDs tracks which owner IDs were passed.
	FetchedOwnerIDs []int64
}

// FetchActivity implements the StravaClient interface.
func (m *MockStravaClient) FetchActivity(_ context.Context, ownerID, activityID int64) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.FetchedOwnerIDs = append(m.FetchedOwnerIDs, ownerID)
	m.FetchedIDs = append(m.FetchedIDs, activityID)
	return m.FetchResult, m.FetchErr
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
	return m.DeleteErr
}

// DeletedCount returns the number of delete calls made.
func (m *MockTokenStore) DeletedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.DeletedAthleteIDs)
}
