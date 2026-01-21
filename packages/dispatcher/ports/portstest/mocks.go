// Package portstest provides mock implementations of port interfaces for testing.
package portstest

import (
	"context"

	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// MockPublisher is a mock implementation of the Publisher interface for testing.
type MockPublisher struct {
	PublishErr error
	Published  []*generated.WebhookEvent
}

// Publish implements the mock publisher.
func (m *MockPublisher) Publish(ctx context.Context, webhook *generated.WebhookEvent, correlationID string) error {
	if m.PublishErr == nil {
		m.Published = append(m.Published, webhook)
	}
	return m.PublishErr
}

// Close implements the Publisher interface for MockPublisher.
func (m *MockPublisher) Close(ctx context.Context) error {
	return nil
}

// MockSecretProvider is a mock implementation of SecretProvider for testing.
type MockSecretProvider struct {
	VerifyToken    string
	SubscriptionID int
	Err            error
}

// GetSecrets implements the SecretProvider interface.
func (m *MockSecretProvider) GetSecrets() (string, int, error) {
	return m.VerifyToken, m.SubscriptionID, m.Err
}
