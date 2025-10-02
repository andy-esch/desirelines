package dispatcher

import (
	"testing"
)

func TestWebhookRequest_Validate_Success(t *testing.T) {
	tests := []struct {
		name    string
		webhook WebhookRequest
	}{
		{
			name: "valid create activity webhook",
			webhook: WebhookRequest{
				AspectType:     "create",
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     "activity",
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{},
			},
		},
		{
			name: "valid update activity webhook",
			webhook: WebhookRequest{
				AspectType:     "update",
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     "activity",
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{"title": "New Title"},
			},
		},
		{
			name: "valid delete activity webhook",
			webhook: WebhookRequest{
				AspectType:     "delete",
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     "activity",
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.webhook.Validate()
			if err != nil {
				t.Errorf("WebhookRequest.Validate() error = %v, want nil", err)
			}
		})
	}
}

func TestWebhookRequest_Validate_InvalidAspectType(t *testing.T) {
	webhook := WebhookRequest{
		AspectType:     "invalid",
		EventTime:      1693536000,
		ObjectID:       12345,
		ObjectType:     "activity",
		OwnerID:        67890,
		SubscriptionID: 123456,
	}

	err := webhook.Validate()
	if err == nil {
		t.Error("WebhookRequest.Validate() error = nil, want error for invalid aspect_type")
	}

	expectedMsg := "invalid aspect_type: invalid"
	if err.Error() != expectedMsg {
		t.Errorf("WebhookRequest.Validate() error = %v, want %v", err.Error(), expectedMsg)
	}
}

func TestWebhookRequest_Validate_InvalidObjectType(t *testing.T) {
	webhook := WebhookRequest{
		AspectType:     "create",
		EventTime:      1693536000,
		ObjectID:       12345,
		ObjectType:     "invalid", // Neither "activity" nor "athlete"
		OwnerID:        67890,
		SubscriptionID: 123456,
	}

	err := webhook.Validate()
	if err == nil {
		t.Error("WebhookRequest.Validate() error = nil, want error for invalid object_type")
	}

	expectedMsg := "invalid object_type: invalid"
	if err.Error() != expectedMsg {
		t.Errorf("WebhookRequest.Validate() error = %v, want %v", err.Error(), expectedMsg)
	}
}

func TestWebhookRequest_Validate_MissingRequiredFields(t *testing.T) {
	tests := []struct {
		name        string
		expectedErr string
		webhook     WebhookRequest
	}{
		{
			name: "missing event_time",
			webhook: WebhookRequest{
				AspectType:     "create",
				ObjectID:       12345,
				ObjectType:     "activity",
				OwnerID:        67890,
				SubscriptionID: 123456,
			},
			expectedErr: "event_time is required",
		},
		{
			name: "missing object_id",
			webhook: WebhookRequest{
				AspectType:     "create",
				EventTime:      1693536000,
				ObjectType:     "activity",
				OwnerID:        67890,
				SubscriptionID: 123456,
			},
			expectedErr: "object_id is required",
		},
		{
			name: "missing owner_id",
			webhook: WebhookRequest{
				AspectType:     "create",
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     "activity",
				SubscriptionID: 123456,
			},
			expectedErr: "owner_id is required",
		},
		{
			name: "missing subscription_id",
			webhook: WebhookRequest{
				AspectType: "create",
				EventTime:  1693536000,
				ObjectID:   12345,
				ObjectType: "activity",
				OwnerID:    67890,
			},
			expectedErr: "subscription_id is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.webhook.Validate()
			if err == nil {
				t.Errorf("WebhookRequest.Validate() error = nil, want error for %s", tt.name)
				return
			}

			if err.Error() != tt.expectedErr {
				t.Errorf("WebhookRequest.Validate() error = %v, want %v", err.Error(), tt.expectedErr)
			}
		})
	}
}
