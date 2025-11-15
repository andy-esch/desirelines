package dispatcher

import (
	"context"
	"errors"
	"testing"
)

func TestMockPublisher_Publish_Success(t *testing.T) {
	mock := &MockPublisher{}
	ctx := context.Background()

	webhook := WebhookRequest{
		AspectType:     AspectCreate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
		Updates:        map[string]any{},
	}

	err := mock.Publish(ctx, webhook, "test-correlation-id")

	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
	}

	if mock.Published[0].ObjectID != webhook.ObjectID {
		t.Errorf("expected ObjectID=%d, got %d", webhook.ObjectID, mock.Published[0].ObjectID)
	}

	if mock.Published[0].AspectType != webhook.AspectType {
		t.Errorf("expected AspectType=%s, got %s", webhook.AspectType, mock.Published[0].AspectType)
	}
}

func TestMockPublisher_Publish_Error(t *testing.T) {
	expectedErr := errors.New("publish failed")
	mock := &MockPublisher{
		PublishErr: expectedErr,
	}
	ctx := context.Background()

	webhook := WebhookRequest{
		AspectType:     AspectCreate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
	}

	err := mock.Publish(ctx, webhook, "test-correlation-id")

	if err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, err)
	}

	if len(mock.Published) != 0 {
		t.Errorf("expected 0 published webhooks on error, got %d", len(mock.Published))
	}
}

func TestMockPublisher_Publish_Multiple(t *testing.T) {
	mock := &MockPublisher{}
	ctx := context.Background()

	webhooks := []WebhookRequest{
		{
			AspectType:     AspectCreate,
			ObjectType:     ObjectActivity,
			EventTime:      1234567890,
			ObjectID:       111,
			OwnerID:        222,
			SubscriptionID: 333,
		},
		{
			AspectType:     AspectUpdate,
			ObjectType:     ObjectActivity,
			EventTime:      1234567891,
			ObjectID:       112,
			OwnerID:        222,
			SubscriptionID: 333,
		},
		{
			AspectType:     AspectDelete,
			ObjectType:     ObjectActivity,
			EventTime:      1234567892,
			ObjectID:       113,
			OwnerID:        222,
			SubscriptionID: 333,
		},
	}

	for i, webhook := range webhooks {
		err := mock.Publish(ctx, webhook, "correlation-id-"+string(rune(i)))
		if err != nil {
			t.Errorf("publish %d failed: %v", i, err)
		}
	}

	if len(mock.Published) != len(webhooks) {
		t.Errorf("expected %d published webhooks, got %d", len(webhooks), len(mock.Published))
	}

	for i, published := range mock.Published {
		if published.ObjectID != webhooks[i].ObjectID {
			t.Errorf("webhook %d: expected ObjectID=%d, got %d", i, webhooks[i].ObjectID, published.ObjectID)
		}
		if published.AspectType != webhooks[i].AspectType {
			t.Errorf("webhook %d: expected AspectType=%s, got %s", i, webhooks[i].AspectType, published.AspectType)
		}
	}
}

func TestMockPublisher_Publish_DifferentAspectTypes(t *testing.T) {
	tests := []struct {
		name       string
		aspectType string
	}{
		{
			name:       "create aspect",
			aspectType: AspectCreate,
		},
		{
			name:       "update aspect",
			aspectType: AspectUpdate,
		},
		{
			name:       "delete aspect",
			aspectType: AspectDelete,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &MockPublisher{}
			ctx := context.Background()

			webhook := WebhookRequest{
				AspectType:     tt.aspectType,
				ObjectType:     ObjectActivity,
				EventTime:      1234567890,
				ObjectID:       111,
				OwnerID:        222,
				SubscriptionID: 333,
			}

			err := mock.Publish(ctx, webhook, "test-correlation-id")

			if err != nil {
				t.Errorf("expected no error, got %v", err)
			}

			if len(mock.Published) != 1 {
				t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
			}

			if mock.Published[0].AspectType != tt.aspectType {
				t.Errorf("expected AspectType=%s, got %s", tt.aspectType, mock.Published[0].AspectType)
			}
		})
	}
}

func TestMockPublisher_Publish_DifferentObjectTypes(t *testing.T) {
	tests := []struct {
		name       string
		objectType string
	}{
		{
			name:       "activity object",
			objectType: ObjectActivity,
		},
		{
			name:       "athlete object",
			objectType: ObjectAthlete,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &MockPublisher{}
			ctx := context.Background()

			webhook := WebhookRequest{
				AspectType:     AspectCreate,
				ObjectType:     tt.objectType,
				EventTime:      1234567890,
				ObjectID:       111,
				OwnerID:        222,
				SubscriptionID: 333,
			}

			err := mock.Publish(ctx, webhook, "test-correlation-id")

			if err != nil {
				t.Errorf("expected no error, got %v", err)
			}

			if len(mock.Published) != 1 {
				t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
			}

			if mock.Published[0].ObjectType != tt.objectType {
				t.Errorf("expected ObjectType=%s, got %s", tt.objectType, mock.Published[0].ObjectType)
			}
		})
	}
}

func TestMockPublisher_Publish_WithUpdates(t *testing.T) {
	mock := &MockPublisher{}
	ctx := context.Background()

	updates := map[string]any{
		"title":       "Morning Run",
		"description": "Easy recovery run",
		"private":     false,
	}

	webhook := WebhookRequest{
		AspectType:     AspectUpdate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
		Updates:        updates,
	}

	err := mock.Publish(ctx, webhook, "test-correlation-id")

	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
	}

	publishedUpdates := mock.Published[0].Updates
	if len(publishedUpdates) != len(updates) {
		t.Errorf("expected %d updates, got %d", len(updates), len(publishedUpdates))
	}

	for key, value := range updates {
		if publishedUpdates[key] != value {
			t.Errorf("expected updates[%s]=%v, got %v", key, value, publishedUpdates[key])
		}
	}
}

func TestMockPublisher_Publish_ContextCancellation(t *testing.T) {
	mock := &MockPublisher{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	webhook := WebhookRequest{
		AspectType:     AspectCreate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
	}

	// MockPublisher doesn't check context cancellation, but we verify it accepts context
	err := mock.Publish(ctx, webhook, "test-correlation-id")

	// Mock implementation doesn't check context, so this should succeed
	if err != nil {
		t.Errorf("expected no error from mock, got %v", err)
	}

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
	}
}

func TestMockPublisher_Reset(t *testing.T) {
	mock := &MockPublisher{}
	ctx := context.Background()

	webhook := WebhookRequest{
		AspectType:     AspectCreate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
	}

	// Publish first webhook
	mock.Publish(ctx, webhook, "correlation-1")

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook, got %d", len(mock.Published))
	}

	// Reset by creating new mock instance
	mock = &MockPublisher{}

	if len(mock.Published) != 0 {
		t.Errorf("expected 0 published webhooks after reset, got %d", len(mock.Published))
	}

	// Publish after reset
	mock.Publish(ctx, webhook, "correlation-2")

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook after reset, got %d", len(mock.Published))
	}
}

func TestMockPublisher_ErrorThenSuccess(t *testing.T) {
	expectedErr := errors.New("temporary failure")
	mock := &MockPublisher{
		PublishErr: expectedErr,
	}
	ctx := context.Background()

	webhook := WebhookRequest{
		AspectType:     AspectCreate,
		ObjectType:     ObjectActivity,
		EventTime:      1234567890,
		ObjectID:       111,
		OwnerID:        222,
		SubscriptionID: 333,
	}

	// First publish should fail
	err := mock.Publish(ctx, webhook, "correlation-1")
	if err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, err)
	}

	if len(mock.Published) != 0 {
		t.Errorf("expected 0 published webhooks after error, got %d", len(mock.Published))
	}

	// Clear error
	mock.PublishErr = nil

	// Second publish should succeed
	err = mock.Publish(ctx, webhook, "correlation-2")
	if err != nil {
		t.Errorf("expected no error after clearing PublishErr, got %v", err)
	}

	if len(mock.Published) != 1 {
		t.Errorf("expected 1 published webhook after clearing error, got %d", len(mock.Published))
	}
}

// Note: NewPubSubPublisher and PubSubPublisher.Publish require actual Pub/Sub connection
// and are better suited for integration tests. The MockPublisher tests above verify
// the Publisher interface contract is correctly implemented.
