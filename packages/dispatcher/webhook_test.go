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
				AspectType:     AspectCreate,
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     ObjectActivity,
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{},
			},
		},
		{
			name: "valid update activity webhook",
			webhook: WebhookRequest{
				AspectType:     AspectUpdate,
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     ObjectActivity,
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{"title": "New Title"},
			},
		},
		{
			name: "valid delete activity webhook",
			webhook: WebhookRequest{
				AspectType:     AspectDelete,
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     ObjectActivity,
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{},
			},
		},
		{
			name: "valid athlete webhook",
			webhook: WebhookRequest{
				AspectType:     AspectUpdate,
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     ObjectAthlete,
				OwnerID:        67890,
				SubscriptionID: 123456,
				Updates:        map[string]any{"authorized": "false"},
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
		AspectType:     AspectCreate,
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
				AspectType:     AspectCreate,
				ObjectID:       12345,
				ObjectType:     ObjectActivity,
				OwnerID:        67890,
				SubscriptionID: 123456,
			},
			expectedErr: "event_time is required",
		},
		{
			name: "missing object_id",
			webhook: WebhookRequest{
				AspectType:     AspectCreate,
				EventTime:      1693536000,
				ObjectType:     ObjectActivity,
				OwnerID:        67890,
				SubscriptionID: 123456,
			},
			expectedErr: "object_id is required",
		},
		{
			name: "missing owner_id",
			webhook: WebhookRequest{
				AspectType:     AspectCreate,
				EventTime:      1693536000,
				ObjectID:       12345,
				ObjectType:     ObjectActivity,
				SubscriptionID: 123456,
			},
			expectedErr: "owner_id is required",
		},
		{
			name: "missing subscription_id",
			webhook: WebhookRequest{
				AspectType: AspectCreate,
				EventTime:  1693536000,
				ObjectID:   12345,
				ObjectType: ObjectActivity,
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

// TestAspectType_Valid tests the type-safe AspectType.Valid() method.
func TestAspectType_Valid(t *testing.T) {
	tests := []struct {
		name       string
		aspectType AspectType
		want       bool
	}{
		{name: "valid create", aspectType: AspectCreate, want: true},
		{name: "valid update", aspectType: AspectUpdate, want: true},
		{name: "valid delete", aspectType: AspectDelete, want: true},
		{name: "invalid empty", aspectType: AspectType(""), want: false},
		{name: "invalid unknown", aspectType: AspectType("unknown"), want: false},
		{name: "invalid case mismatch", aspectType: AspectType("Create"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.aspectType.Valid(); got != tt.want {
				t.Errorf("AspectType.Valid() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestObjectType_Valid tests the type-safe ObjectType.Valid() method.
func TestObjectType_Valid(t *testing.T) {
	tests := []struct {
		name       string
		objectType ObjectType
		want       bool
	}{
		{name: "valid activity", objectType: ObjectActivity, want: true},
		{name: "valid athlete", objectType: ObjectAthlete, want: true},
		{name: "invalid empty", objectType: ObjectType(""), want: false},
		{name: "invalid unknown", objectType: ObjectType("unknown"), want: false},
		{name: "invalid case mismatch", objectType: ObjectType("Activity"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.objectType.Valid(); got != tt.want {
				t.Errorf("ObjectType.Valid() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestAspectType_String tests the String() method.
func TestAspectType_String(t *testing.T) {
	tests := []struct {
		name       string
		aspectType AspectType
		want       string
	}{
		{name: "create", aspectType: AspectCreate, want: "create"},
		{name: "update", aspectType: AspectUpdate, want: "update"},
		{name: "delete", aspectType: AspectDelete, want: "delete"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.aspectType.String(); got != tt.want {
				t.Errorf("AspectType.String() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestObjectType_String tests the String() method.
func TestObjectType_String(t *testing.T) {
	tests := []struct {
		name       string
		objectType ObjectType
		want       string
	}{
		{name: "activity", objectType: ObjectActivity, want: "activity"},
		{name: "athlete", objectType: ObjectAthlete, want: "athlete"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.objectType.String(); got != tt.want {
				t.Errorf("ObjectType.String() = %v, want %v", got, tt.want)
			}
		})
	}
}
