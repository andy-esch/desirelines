// Package portstest provides mock implementations of port interfaces for testing.
package portstest

import (
	"context"
	"encoding/json"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// MockPublisher is a mock implementation of the Publisher interface for testing.
type MockPublisher struct {
	PublishErr error
	Published  []*generated.EnrichedEvent
}

// Publish implements the mock publisher.
func (m *MockPublisher) Publish(_ context.Context, enriched *generated.EnrichedEvent, _ string) error {
	if m.PublishErr == nil {
		m.Published = append(m.Published, enriched)
	}
	return m.PublishErr
}

// Close implements the Publisher interface for MockPublisher.
func (m *MockPublisher) Close(_ context.Context) error {
	return nil
}

// PublishedRawActivities returns the raw_activity JSON from each published event,
// parsed as a map for easy assertion. Returns nil entries for events without raw_activity.
func (m *MockPublisher) PublishedRawActivities() []map[string]any {
	result := make([]map[string]any, 0, len(m.Published))
	for _, e := range m.Published {
		if e.RawActivity == nil {
			result = append(result, nil)
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal(e.RawActivity, &parsed); err != nil {
			// In a test mock helper, we can't easily fail the test without a *testing.T
			// but we can ensure we don't return partial data.
			result = append(result, map[string]any{"_parse_error": err.Error()})
			continue
		}
		result = append(result, parsed)
	}
	return result
}

// MockSecretProvider is a mock implementation of SecretProvider for testing.
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
type MockStravaClient struct {
	// FetchResult is the raw JSON bytes to return.
	FetchResult []byte
	// FetchErr is the error to return.
	FetchErr error
	// FetchedIDs tracks which activity IDs were fetched.
	FetchedIDs []int64
	// FetchedOwnerIDs tracks which owner IDs were passed.
	FetchedOwnerIDs []int64
}

// FetchActivity implements the StravaClient interface.
func (m *MockStravaClient) FetchActivity(_ context.Context, ownerID, activityID int64) ([]byte, error) {
	m.FetchedOwnerIDs = append(m.FetchedOwnerIDs, ownerID)
	m.FetchedIDs = append(m.FetchedIDs, activityID)
	return m.FetchResult, m.FetchErr
}

// MockTokenStore is a mock implementation of TokenStore for testing.
type MockTokenStore struct {
	// Tokens maps athlete IDs to their token data.
	Tokens map[int64]*stravatoken.Data
	// GetErr is returned by GetTokens (overrides Tokens lookup).
	GetErr error
	// WriteErr is returned by WriteTokensIfUnmodified.
	WriteErr error
	// WrittenTokens tracks tokens written by WriteTokensIfUnmodified.
	WrittenTokens map[int64]*stravatoken.Data
	// SimulateConflict causes WriteTokensIfUnmodified to return ErrTokenConflict.
	SimulateConflict bool
}

// GetTokens implements the TokenStore interface.
func (m *MockTokenStore) GetTokens(_ context.Context, athleteID int64) (*stravatoken.Data, error) {
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
	if m.SimulateConflict {
		return ports.ErrTokenConflict
	}
	if m.WriteErr != nil {
		return m.WriteErr
	}
	if m.WrittenTokens == nil {
		m.WrittenTokens = make(map[int64]*stravatoken.Data)
	}
	m.WrittenTokens[athleteID] = tokens
	return nil
}
