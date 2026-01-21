package proto

import (
	"testing"

	pb "github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

func TestParseStravaWebhook(t *testing.T) {
	tests := []struct {
		name       string
		json       string
		wantErr    bool
		wantAspect pb.AspectType
		wantObject pb.ObjectType
	}{
		{
			name: "valid create activity",
			json: `{
				"aspect_type": "create",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999
			}`,
			wantErr:    false,
			wantAspect: pb.AspectType_ASPECT_TYPE_CREATE,
			wantObject: pb.ObjectType_OBJECT_TYPE_ACTIVITY,
		},
		{
			name: "valid update athlete",
			json: `{
				"aspect_type": "update",
				"object_type": "athlete",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999,
				"updates": {"authorized": "false"}
			}`,
			wantErr:    false,
			wantAspect: pb.AspectType_ASPECT_TYPE_UPDATE,
			wantObject: pb.ObjectType_OBJECT_TYPE_ATHLETE,
		},
		{
			name: "valid delete activity",
			json: `{
				"aspect_type": "delete",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999
			}`,
			wantErr:    false,
			wantAspect: pb.AspectType_ASPECT_TYPE_DELETE,
			wantObject: pb.ObjectType_OBJECT_TYPE_ACTIVITY,
		},
		{
			name: "invalid aspect_type",
			json: `{
				"aspect_type": "invalid",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999
			}`,
			wantErr: true,
		},
		{
			name: "invalid object_type",
			json: `{
				"aspect_type": "create",
				"object_type": "invalid",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999
			}`,
			wantErr: true,
		},
		{
			name:    "invalid JSON",
			json:    `not json`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event, err := ParseStravaWebhook([]byte(tt.json))
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseStravaWebhook() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr {
				if event.AspectType != tt.wantAspect {
					t.Errorf("AspectType = %v, want %v", event.AspectType, tt.wantAspect)
				}
				if event.ObjectType != tt.wantObject {
					t.Errorf("ObjectType = %v, want %v", event.ObjectType, tt.wantObject)
				}
			}
		})
	}
}

func TestToStravaJSON(t *testing.T) {
	title := "Morning Run"
	event := &pb.WebhookEvent{
		AspectType:     pb.AspectType_ASPECT_TYPE_UPDATE,
		ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
		ObjectId:       12345,
		OwnerId:        67890,
		EventTime:      1704067200,
		SubscriptionId: 999,
		Updates: &pb.ActivityUpdates{
			Title: &title,
		},
	}

	data, err := ToStravaJSON(event)
	if err != nil {
		t.Fatalf("ToStravaJSON() error = %v", err)
	}

	// Parse back to verify roundtrip
	parsed, err := ParseStravaWebhook(data)
	if err != nil {
		t.Fatalf("Roundtrip parse error = %v", err)
	}

	if parsed.AspectType != event.AspectType {
		t.Errorf("Roundtrip AspectType = %v, want %v", parsed.AspectType, event.AspectType)
	}
	if parsed.ObjectType != event.ObjectType {
		t.Errorf("Roundtrip ObjectType = %v, want %v", parsed.ObjectType, event.ObjectType)
	}
	if parsed.ObjectId != event.ObjectId {
		t.Errorf("Roundtrip ObjectId = %v, want %v", parsed.ObjectId, event.ObjectId)
	}
	if parsed.Updates == nil || parsed.Updates.Title == nil {
		t.Error("Roundtrip ActivityUpdates.Title is nil")
	} else if *parsed.Updates.Title != title {
		t.Errorf("Roundtrip ActivityUpdates.Title = %v, want %v", *parsed.Updates.Title, title)
	}
}

func TestParseActivityUpdates(t *testing.T) {
	tests := []struct {
		name        string
		json        string
		wantTitle   *string
		wantType    *string
		wantPrivate *bool
	}{
		{
			name: "activity update with title",
			json: `{
				"aspect_type": "update",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999,
				"updates": {"title": "Evening Ride"}
			}`,
			wantTitle: strPtr("Evening Ride"),
		},
		{
			name: "activity update with type",
			json: `{
				"aspect_type": "update",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999,
				"updates": {"type": "Ride"}
			}`,
			wantType: strPtr("Ride"),
		},
		{
			name: "activity update with private true",
			json: `{
				"aspect_type": "update",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999,
				"updates": {"private": "true"}
			}`,
			wantPrivate: boolPtr(true),
		},
		{
			name: "activity update with all fields",
			json: `{
				"aspect_type": "update",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999,
				"updates": {"title": "Morning Run", "type": "Run", "private": "false"}
			}`,
			wantTitle:   strPtr("Morning Run"),
			wantType:    strPtr("Run"),
			wantPrivate: boolPtr(false),
		},
		{
			name: "create event has no activity updates",
			json: `{
				"aspect_type": "create",
				"object_type": "activity",
				"object_id": 12345,
				"owner_id": 67890,
				"event_time": 1704067200,
				"subscription_id": 999
			}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event, err := ParseStravaWebhook([]byte(tt.json))
			if err != nil {
				t.Fatalf("ParseStravaWebhook() error = %v", err)
			}

			if tt.wantTitle == nil && tt.wantType == nil && tt.wantPrivate == nil {
				if event.Updates != nil {
					t.Errorf("Expected ActivityUpdates to be nil, got %+v", event.Updates)
				}
				return
			}

			if event.Updates == nil {
				t.Fatal("ActivityUpdates is nil, expected non-nil")
			}

			if tt.wantTitle != nil {
				if event.Updates.Title == nil || *event.Updates.Title != *tt.wantTitle {
					t.Errorf("Title = %v, want %v", event.Updates.Title, *tt.wantTitle)
				}
			}
			if tt.wantType != nil {
				if event.Updates.Type == nil || *event.Updates.Type != *tt.wantType {
					t.Errorf("Type = %v, want %v", event.Updates.Type, *tt.wantType)
				}
			}
			if tt.wantPrivate != nil {
				if event.Updates.Private == nil || *event.Updates.Private != *tt.wantPrivate {
					t.Errorf("Private = %v, want %v", event.Updates.Private, *tt.wantPrivate)
				}
			}
		})
	}
}

func strPtr(s string) *string {
	return &s
}

func boolPtr(b bool) *bool {
	return &b
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		event   *pb.WebhookEvent
		wantErr bool
	}{
		{
			name: "valid event",
			event: &pb.WebhookEvent{
				AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				ObjectId:       12345,
				OwnerId:        67890,
				EventTime:      1704067200,
				SubscriptionId: 999,
			},
			wantErr: false,
		},
		{
			name: "missing aspect_type",
			event: &pb.WebhookEvent{
				ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				ObjectId:       12345,
				OwnerId:        67890,
				EventTime:      1704067200,
				SubscriptionId: 999,
			},
			wantErr: true,
		},
		{
			name: "missing object_type",
			event: &pb.WebhookEvent{
				AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectId:       12345,
				OwnerId:        67890,
				EventTime:      1704067200,
				SubscriptionId: 999,
			},
			wantErr: true,
		},
		{
			name: "missing object_id",
			event: &pb.WebhookEvent{
				AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				OwnerId:        67890,
				EventTime:      1704067200,
				SubscriptionId: 999,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.event)
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestAspectTypeRoundtrip(t *testing.T) {
	tests := []struct {
		str  string
		enum pb.AspectType
	}{
		{"create", pb.AspectType_ASPECT_TYPE_CREATE},
		{"update", pb.AspectType_ASPECT_TYPE_UPDATE},
		{"delete", pb.AspectType_ASPECT_TYPE_DELETE},
	}

	for _, tt := range tests {
		t.Run(tt.str, func(t *testing.T) {
			parsed, err := parseAspectType(tt.str)
			if err != nil {
				t.Fatalf("parseAspectType(%q) error = %v", tt.str, err)
			}
			if parsed != tt.enum {
				t.Errorf("parseAspectType(%q) = %v, want %v", tt.str, parsed, tt.enum)
			}
			back := AspectTypeToString(parsed)
			if back != tt.str {
				t.Errorf("AspectTypeToString(%v) = %q, want %q", parsed, back, tt.str)
			}
		})
	}
}

func TestObjectTypeRoundtrip(t *testing.T) {
	tests := []struct {
		str  string
		enum pb.ObjectType
	}{
		{"activity", pb.ObjectType_OBJECT_TYPE_ACTIVITY},
		{"athlete", pb.ObjectType_OBJECT_TYPE_ATHLETE},
	}

	for _, tt := range tests {
		t.Run(tt.str, func(t *testing.T) {
			parsed, err := parseObjectType(tt.str)
			if err != nil {
				t.Fatalf("parseObjectType(%q) error = %v", tt.str, err)
			}
			if parsed != tt.enum {
				t.Errorf("parseObjectType(%q) = %v, want %v", tt.str, parsed, tt.enum)
			}
			back := ObjectTypeToString(parsed)
			if back != tt.str {
				t.Errorf("ObjectTypeToString(%v) = %q, want %q", parsed, back, tt.str)
			}
		})
	}
}
