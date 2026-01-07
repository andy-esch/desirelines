// Package proto provides adapters for converting between Strava JSON and protobuf types.
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

	return &pb.WebhookEvent{
		AspectType:     aspectType,
		ObjectType:     objectType,
		ObjectId:       raw.ObjectID,
		OwnerId:        raw.OwnerID,
		EventTime:      raw.EventTime,
		SubscriptionId: raw.SubscriptionID,
		Updates:        raw.Updates,
	}, nil
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
		Updates:        event.Updates,
	}
	return json.Marshal(raw)
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
