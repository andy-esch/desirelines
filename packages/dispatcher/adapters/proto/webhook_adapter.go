package proto

import (
	"encoding/json"
	"fmt"

	pb "github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

// StravaWebhookJSON represents the raw JSON structure from Strava webhooks.
// Strava sends string enums ("create", "activity") while proto uses int enums.
type StravaWebhookJSON struct {
	AspectType     string            `json:"aspect_type"`
	ObjectType     string            `json:"object_type"`
	ObjectID       int64             `json:"object_id"`
	OwnerID        int64             `json:"owner_id"`
	EventTime      int64             `json:"event_time"`
	SubscriptionID int32             `json:"subscription_id"`
	Updates        map[string]string `json:"updates"`
}

// ParseStravaWebhook parses raw JSON from Strava into a protobuf WebhookEvent.
func ParseStravaWebhook(data []byte) (*pb.WebhookEvent, error) {
	var raw StravaWebhookJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webhook JSON: %w", err)
	}

	aspectType, err := parseAspectType(raw.AspectType)
	if err != nil {
		return nil, err
	}

	objectType, err := parseObjectType(raw.ObjectType)
	if err != nil {
		return nil, err
	}

	event := &pb.WebhookEvent{
		AspectType:     aspectType,
		ObjectType:     objectType,
		ObjectId:       raw.ObjectID,
		OwnerId:        raw.OwnerID,
		EventTime:      raw.EventTime,
		SubscriptionId: raw.SubscriptionID,
	}

	// Convert updates map to typed ActivityUpdates for activity update events
	if objectType == pb.ObjectType_OBJECT_TYPE_ACTIVITY &&
		aspectType == pb.AspectType_ASPECT_TYPE_UPDATE &&
		len(raw.Updates) > 0 {
		event.Updates = parseActivityUpdates(raw.Updates)
	}

	return event, nil
}

// parseActivityUpdates converts Strava's updates map to typed ActivityUpdates.
func parseActivityUpdates(updates map[string]string) *pb.ActivityUpdates {
	if len(updates) == 0 {
		return nil
	}

	activityUpdates := &pb.ActivityUpdates{}

	if title, ok := updates["title"]; ok {
		activityUpdates.Title = &title
	}

	if activityType, ok := updates["type"]; ok {
		activityUpdates.Type = &activityType
	}

	if privateStr, ok := updates["private"]; ok {
		private := privateStr == "true"
		activityUpdates.Private = &private
	}

	return activityUpdates
}

// parseAspectType converts Strava's string aspect_type to proto enum.
func parseAspectType(s string) (pb.AspectType, error) {
	switch s {
	case "create":
		return pb.AspectType_ASPECT_TYPE_CREATE, nil
	case "update":
		return pb.AspectType_ASPECT_TYPE_UPDATE, nil
	case "delete":
		return pb.AspectType_ASPECT_TYPE_DELETE, nil
	default:
		return pb.AspectType_ASPECT_TYPE_UNSPECIFIED, fmt.Errorf("invalid aspect_type: %s", s)
	}
}

// parseObjectType converts Strava's string object_type to proto enum.
func parseObjectType(s string) (pb.ObjectType, error) {
	switch s {
	case "activity":
		return pb.ObjectType_OBJECT_TYPE_ACTIVITY, nil
	case "athlete":
		return pb.ObjectType_OBJECT_TYPE_ATHLETE, nil
	default:
		return pb.ObjectType_OBJECT_TYPE_UNSPECIFIED, fmt.Errorf("invalid object_type: %s", s)
	}
}

// AspectTypeToString converts proto AspectType enum to Strava string format.
func AspectTypeToString(at pb.AspectType) string {
	switch at {
	case pb.AspectType_ASPECT_TYPE_CREATE:
		return "create"
	case pb.AspectType_ASPECT_TYPE_UPDATE:
		return "update"
	case pb.AspectType_ASPECT_TYPE_DELETE:
		return "delete"
	default:
		return ""
	}
}

// ObjectTypeToString converts proto ObjectType enum to Strava string format.
func ObjectTypeToString(ot pb.ObjectType) string {
	switch ot {
	case pb.ObjectType_OBJECT_TYPE_ACTIVITY:
		return "activity"
	case pb.ObjectType_OBJECT_TYPE_ATHLETE:
		return "athlete"
	default:
		return ""
	}
}

// EnrichedEventJSON extends the webhook JSON with raw activity data.
// Python consumers call json.loads() and get raw_activity as a dict directly.
type EnrichedEventJSON struct {
	AspectType     string            `json:"aspect_type"`
	ObjectType     string            `json:"object_type"`
	ObjectID       int64             `json:"object_id"`
	OwnerID        int64             `json:"owner_id"`
	EventTime      int64             `json:"event_time"`
	SubscriptionID int32             `json:"subscription_id"`
	Updates        map[string]string `json:"updates,omitempty"`
	RawActivity    json.RawMessage   `json:"raw_activity,omitempty"`
}

// ToStravaJSON converts a protobuf WebhookEvent back to Strava JSON format.
// Useful for publishing to PubSub in a format stravapipe expects.
func ToStravaJSON(event *pb.WebhookEvent) ([]byte, error) {
	raw := StravaWebhookJSON{
		AspectType:     AspectTypeToString(event.AspectType),
		ObjectType:     ObjectTypeToString(event.ObjectType),
		ObjectID:       event.ObjectId,
		OwnerID:        event.OwnerId,
		EventTime:      event.EventTime,
		SubscriptionID: event.SubscriptionId,
		Updates:        activityUpdatesToMap(event.Updates),
	}
	return json.Marshal(raw)
}

// ToEnrichedJSON converts an EnrichedEvent to JSON for PubSub publishing.
// Maintains string enums ("create", "activity") and includes raw_activity
// as a nested JSON object (not base64).
func ToEnrichedJSON(enriched *pb.EnrichedEvent) ([]byte, error) {
	if enriched == nil || enriched.Event == nil {
		return nil, fmt.Errorf("enriched event or inner event is nil")
	}

	event := enriched.Event
	result := EnrichedEventJSON{
		AspectType:     AspectTypeToString(event.AspectType),
		ObjectType:     ObjectTypeToString(event.ObjectType),
		ObjectID:       event.ObjectId,
		OwnerID:        event.OwnerId,
		EventTime:      event.EventTime,
		SubscriptionID: event.SubscriptionId,
		Updates:        activityUpdatesToMap(event.Updates),
	}

	if enriched.RawActivity != nil {
		result.RawActivity = json.RawMessage(enriched.RawActivity)
	}

	return json.Marshal(result)
}

// activityUpdatesToMap converts typed ActivityUpdates back to map for JSON serialization.
func activityUpdatesToMap(updates *pb.ActivityUpdates) map[string]string {
	if updates == nil {
		return nil
	}

	result := make(map[string]string)

	if updates.Title != nil {
		result["title"] = *updates.Title
	}

	if updates.Type != nil {
		result["type"] = *updates.Type
	}

	if updates.Private != nil {
		if *updates.Private {
			result["private"] = "true"
		} else {
			result["private"] = "false"
		}
	}

	if len(result) == 0 {
		return nil
	}

	return result
}

// Validate checks if the WebhookEvent has valid required fields.
func Validate(event *pb.WebhookEvent) error {
	if event.AspectType == pb.AspectType_ASPECT_TYPE_UNSPECIFIED {
		return fmt.Errorf("aspect_type is required")
	}
	if event.ObjectType == pb.ObjectType_OBJECT_TYPE_UNSPECIFIED {
		return fmt.Errorf("object_type is required")
	}
	if event.EventTime == 0 {
		return fmt.Errorf("event_time is required")
	}
	if event.ObjectId == 0 {
		return fmt.Errorf("object_id is required")
	}
	if event.OwnerId == 0 {
		return fmt.Errorf("owner_id is required")
	}
	if event.SubscriptionId == 0 {
		return fmt.Errorf("subscription_id is required")
	}
	return nil
}
