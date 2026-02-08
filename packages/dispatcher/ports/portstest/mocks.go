// Package portstest provides mock implementations of port interfaces for testing.
package portstest

import (
	"context"
	"encoding/json"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
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
	var result []map[string]any
	for _, e := range m.Published {
		if e.RawActivity == nil {
			result = append(result, nil)
			continue
		}
		var parsed map[string]any
		_ = json.Unmarshal(e.RawActivity, &parsed)
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
}

// FetchActivity implements the StravaClient interface.
func (m *MockStravaClient) FetchActivity(_ context.Context, activityID int64) ([]byte, error) {
	m.FetchedIDs = append(m.FetchedIDs, activityID)
	return m.FetchResult, m.FetchErr
}
