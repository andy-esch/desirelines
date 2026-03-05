package proto

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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

			wantNilUpdates := tt.wantTitle == nil && tt.wantType == nil && tt.wantPrivate == nil
			if wantNilUpdates {
				if event.Updates != nil {
					t.Errorf("Expected ActivityUpdates to be nil, got %+v", event.Updates)
				}
				return
			}

			if event.Updates == nil {
				t.Fatal("ActivityUpdates is nil, expected non-nil")
			}

			assertOptionalStringField(t, "Title", event.Updates.Title, tt.wantTitle)
			assertOptionalStringField(t, "Type", event.Updates.Type, tt.wantType)
			assertOptionalBoolField(t, "Private", event.Updates.Private, tt.wantPrivate)
		})
	}
}

func assertOptionalStringField(t *testing.T, name string, got, want *string) {
	t.Helper()
	if want == nil {
		return
	}
	if got == nil || *got != *want {
		t.Errorf("%s = %v, want %v", name, got, *want)
	}
}

func assertOptionalBoolField(t *testing.T, name string, got, want *bool) {
	t.Helper()
	if want == nil {
		return
	}
	if got == nil || *got != *want {
		t.Errorf("%s = %v, want %v", name, got, *want)
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
		{
			name: "missing owner_id",
			event: &pb.WebhookEvent{
				AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				ObjectId:       12345,
				EventTime:      1704067200,
				SubscriptionId: 999,
			},
			wantErr: true,
		},
		{
			name: "missing subscription_id",
			event: &pb.WebhookEvent{
				AspectType: pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectType: pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				ObjectId:   12345,
				OwnerId:    67890,
				EventTime:  1704067200,
			},
			wantErr: true,
		},
		{
			name: "missing event_time",
			event: &pb.WebhookEvent{
				AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
				ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
				ObjectId:       12345,
				OwnerId:        67890,
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

const (
	aspectCreate   = "create"
	aspectDelete   = "delete"
	objectActivity = "activity"
)

func TestToEnrichedJSON_WithRawActivity(t *testing.T) {
	rawActivity := []byte(`{"id":12345,"name":"Morning Run","distance":5000}`)
	enriched := &pb.EnrichedEvent{
		Event: &pb.WebhookEvent{
			AspectType:     pb.AspectType_ASPECT_TYPE_CREATE,
			ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
			ObjectId:       12345,
			OwnerId:        67890,
			EventTime:      1704067200,
			SubscriptionId: 999,
		},
		RawActivity: rawActivity,
	}

	data, err := ToEnrichedJSON(enriched)
	if err != nil {
		t.Fatalf("ToEnrichedJSON() error = %v", err)
	}

	// Parse the JSON to verify structure
	var result EnrichedEventJSON
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("Failed to parse result: %v", unmarshalErr)
	}

	if result.AspectType != aspectCreate {
		t.Errorf("aspect_type = %q, want %q", result.AspectType, aspectCreate)
	}
	if result.ObjectType != objectActivity {
		t.Errorf("object_type = %q, want %q", result.ObjectType, objectActivity)
	}
	if result.ObjectID != 12345 {
		t.Errorf("object_id = %d, want %d", result.ObjectID, 12345)
	}
	if result.RawActivity == nil {
		t.Fatal("raw_activity is nil")
	}

	// Verify raw_activity is valid JSON that round-trips
	var activity map[string]any
	if rawUnmarshalErr := json.Unmarshal(result.RawActivity, &activity); rawUnmarshalErr != nil {
		t.Fatalf("raw_activity is not valid JSON: %v", rawUnmarshalErr)
	}
	if activity["name"] != "Morning Run" {
		t.Errorf("raw_activity.name = %v, want %q", activity["name"], "Morning Run")
	}
}

func TestToEnrichedJSON_WithoutRawActivity(t *testing.T) {
	enriched := &pb.EnrichedEvent{
		Event: &pb.WebhookEvent{
			AspectType:     pb.AspectType_ASPECT_TYPE_DELETE,
			ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
			ObjectId:       12345,
			OwnerId:        67890,
			EventTime:      1704067200,
			SubscriptionId: 999,
		},
	}

	data, err := ToEnrichedJSON(enriched)
	if err != nil {
		t.Fatalf("ToEnrichedJSON() error = %v", err)
	}

	var result EnrichedEventJSON
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("Failed to parse result: %v", unmarshalErr)
	}

	if result.AspectType != aspectDelete {
		t.Errorf("aspect_type = %q, want %q", result.AspectType, aspectDelete)
	}
	if result.RawActivity != nil {
		t.Errorf("expected nil raw_activity for DELETE, got %s", string(result.RawActivity))
	}
}

func TestToEnrichedJSON_WithUpdates(t *testing.T) {
	title := "Evening Run"
	enriched := &pb.EnrichedEvent{
		Event: &pb.WebhookEvent{
			AspectType:     pb.AspectType_ASPECT_TYPE_UPDATE,
			ObjectType:     pb.ObjectType_OBJECT_TYPE_ACTIVITY,
			ObjectId:       12345,
			OwnerId:        67890,
			EventTime:      1704067200,
			SubscriptionId: 999,
			Updates: &pb.ActivityUpdates{
				Title: &title,
			},
		},
	}

	data, err := ToEnrichedJSON(enriched)
	if err != nil {
		t.Fatalf("ToEnrichedJSON() error = %v", err)
	}

	var result EnrichedEventJSON
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("Failed to parse result: %v", unmarshalErr)
	}

	if result.Updates == nil || result.Updates["title"] != "Evening Run" {
		t.Errorf("expected updates with title 'Evening Run', got %v", result.Updates)
	}
	if result.RawActivity != nil {
		t.Error("expected nil raw_activity for UPDATE")
	}
}

func TestToEnrichedJSON_NilErrors(t *testing.T) {
	t.Run("nil enriched event returns error", func(t *testing.T) {
		_, err := ToEnrichedJSON(nil)
		if err == nil {
			t.Error("expected error for nil enriched event")
		}
	})

	t.Run("nil inner event returns error", func(t *testing.T) {
		_, err := ToEnrichedJSON(&pb.EnrichedEvent{})
		if err == nil {
			t.Error("expected error for nil inner event")
		}
	})
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

// fixtureCase represents a single test case from the shared fixtures file.
type fixtureCase struct {
	Name        string          `json:"name"`
	Input       json.RawMessage `json:"input"`
	Expected    *fixtureExpect  `json:"expected"`
	ExpectError bool            `json:"expect_error"`
}

type fixtureExpect struct {
	AspectType     string          `json:"aspect_type"`
	ObjectType     string          `json:"object_type"`
	ObjectID       int64           `json:"object_id"`
	OwnerID        int64           `json:"owner_id"`
	EventTime      int64           `json:"event_time"`
	SubscriptionID int32           `json:"subscription_id"`
	Updates        json.RawMessage `json:"updates"`
}

// fixtureUpdates holds the typed updates from the fixture expected block.
type fixtureUpdates struct {
	Title   *string `json:"title"`
	Type    *string `json:"type"`
	Private *bool   `json:"private"`
}

func loadFixtures(t *testing.T) []fixtureCase {
	t.Helper()
	// Resolve path relative to this test file's location
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot determine test file location")
	}
	fixturesPath := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..", "schemas", "test-fixtures", "webhook_events.json")
	data, err := os.ReadFile(fixturesPath) //nolint:gosec // path is relative to test file
	if err != nil {
		t.Fatalf("failed to read shared fixtures: %v", err)
	}
	var fixtures []fixtureCase
	err = json.Unmarshal(data, &fixtures)
	if err != nil {
		t.Fatalf("failed to parse shared fixtures: %v", err)
	}
	return fixtures
}

func verifyBaseFields(t *testing.T, event *pb.WebhookEvent, expected *fixtureExpect) {
	t.Helper()
	if AspectTypeToString(event.AspectType) != expected.AspectType {
		t.Errorf("aspect_type = %q, want %q", AspectTypeToString(event.AspectType), expected.AspectType)
	}
	if ObjectTypeToString(event.ObjectType) != expected.ObjectType {
		t.Errorf("object_type = %q, want %q", ObjectTypeToString(event.ObjectType), expected.ObjectType)
	}
	if event.ObjectId != expected.ObjectID {
		t.Errorf("object_id = %d, want %d", event.ObjectId, expected.ObjectID)
	}
	if event.OwnerId != expected.OwnerID {
		t.Errorf("owner_id = %d, want %d", event.OwnerId, expected.OwnerID)
	}
	if event.EventTime != expected.EventTime {
		t.Errorf("event_time = %d, want %d", event.EventTime, expected.EventTime)
	}
	if event.SubscriptionId != expected.SubscriptionID {
		t.Errorf("subscription_id = %d, want %d", event.SubscriptionId, expected.SubscriptionID)
	}
}

func verifyUpdates(t *testing.T, event *pb.WebhookEvent, expected *fixtureExpect) {
	t.Helper()
	updatesIsNull := expected.Updates == nil || string(expected.Updates) == "null"
	if updatesIsNull {
		if event.Updates != nil {
			t.Errorf("expected nil updates, got %+v", event.Updates)
		}
		return
	}

	if event.Updates == nil {
		t.Fatal("expected non-nil updates, got nil")
	}

	var expectedUpdates fixtureUpdates
	if err := json.Unmarshal(expected.Updates, &expectedUpdates); err != nil {
		t.Fatalf("failed to parse expected updates: %v", err)
	}

	assertOptionalStringField(t, "updates.title", event.Updates.Title, expectedUpdates.Title)
	assertOptionalStringField(t, "updates.type", event.Updates.Type, expectedUpdates.Type)
	assertOptionalBoolField(t, "updates.private", event.Updates.Private, expectedUpdates.Private)
}

func verifyRoundtrip(t *testing.T, event *pb.WebhookEvent) {
	t.Helper()
	jsonData, err := ToStravaJSON(event)
	if err != nil {
		t.Fatalf("ToStravaJSON roundtrip error: %v", err)
	}
	reparsed, err := ParseStravaWebhook(jsonData)
	if err != nil {
		t.Fatalf("roundtrip parse error: %v", err)
	}
	if AspectTypeToString(reparsed.AspectType) != AspectTypeToString(event.AspectType) {
		t.Errorf("roundtrip aspect_type mismatch: %q vs %q",
			AspectTypeToString(reparsed.AspectType), AspectTypeToString(event.AspectType))
	}
	if ObjectTypeToString(reparsed.ObjectType) != ObjectTypeToString(event.ObjectType) {
		t.Errorf("roundtrip object_type mismatch: %q vs %q",
			ObjectTypeToString(reparsed.ObjectType), ObjectTypeToString(event.ObjectType))
	}
	if reparsed.ObjectId != event.ObjectId {
		t.Errorf("roundtrip object_id mismatch: %d vs %d", reparsed.ObjectId, event.ObjectId)
	}
}

func TestAspectTypeToString_Unspecified(t *testing.T) {
	result := AspectTypeToString(pb.AspectType_ASPECT_TYPE_UNSPECIFIED)
	if result != "" {
		t.Errorf("AspectTypeToString(UNSPECIFIED) = %q, want %q", result, "")
	}
}

func TestObjectTypeToString_Unspecified(t *testing.T) {
	result := ObjectTypeToString(pb.ObjectType_OBJECT_TYPE_UNSPECIFIED)
	if result != "" {
		t.Errorf("ObjectTypeToString(UNSPECIFIED) = %q, want %q", result, "")
	}
}

func TestActivityUpdatesToMap_EmptyStruct(t *testing.T) {
	result := activityUpdatesToMap(&pb.ActivityUpdates{})
	if result != nil {
		t.Errorf("activityUpdatesToMap(empty) = %v, want nil", result)
	}
}

func TestSharedFixtures(t *testing.T) {
	fixtures := loadFixtures(t)

	for _, tc := range fixtures {
		t.Run(tc.Name, func(t *testing.T) {
			event, err := ParseStravaWebhook(tc.Input)

			if tc.ExpectError {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Verify all fields match expected
			verifyBaseFields(t, event, tc.Expected)
			verifyUpdates(t, event, tc.Expected)

			// Roundtrip test: proto -> JSON -> proto
			verifyRoundtrip(t, event)
		})
	}
}
