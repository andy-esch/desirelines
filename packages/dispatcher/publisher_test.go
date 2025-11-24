package dispatcher

import (
	"testing"
)

func TestMockPublisher_Close(t *testing.T) {
	mock := &MockPublisher{}

	err := mock.Close()
	if err != nil {
		t.Errorf("MockPublisher.Close() returned error: %v", err)
	}
}

func TestPubSubPublisher_Close_NilClient(t *testing.T) {
	// Test that Close() handles nil client gracefully
	publisher := &PubSubPublisher{
		client:    nil,
		publisher: nil,
	}

	err := publisher.Close()
	if err != nil {
		t.Errorf("PubSubPublisher.Close() with nil client returned error: %v", err)
	}
}
