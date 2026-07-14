package proto

import (
	"encoding/json"
	"fmt"
	"strconv"

	pb "github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

const (
	aspectCreate   = "create"
	aspectUpdate   = "update"
	aspectDelete   = "delete"
	objectActivity = "activity"
	objectAthlete  = "athlete"
)

// StravaWebhookJSON represents the raw JSON structure from Strava webhooks.
// Strava sends string enums ("create", "activity") while proto uses int enums.
//
// Per https://developers.strava.com/docs/webhooks/:
//   - object_type: "activity" or "athlete"
//   - aspect_type: "create", "update", or "delete"
//   - updates (activities): title, type, private
//   - updates (athlete deauth): {"authorized":"false"} — or the bare boolean
//     {"authorized":false}; both are tolerated (see the Updates field note).
type StravaWebhookJSON struct {
	AspectType     string `json:"aspect_type"`
	ObjectType     string `json:"object_type"`
	ObjectID       int64  `json:"object_id"`
	OwnerID        int64  `json:"owner_id"`
	EventTime      int64  `json:"event_time"`
	SubscriptionID int32  `json:"subscription_id"`
	// `any` (not string) so a non-string value can't reject the WHOLE webhook at unmarshal
	// time — Strava documents string updates ({"authorized":"false"}) but has been seen to
	// send a bare boolean ({"authorized":false}), which would otherwise 400 the envelope
	// and silently drop the deauthorization. Coerced per-key below.
	Updates map[string]any `json:"updates"`
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

	// Convert updates map to typed ActivityUpdates for activity update events.
	// Athlete updates (e.g., deauth {"authorized":"false"}) are handled by the
	// HTTP handler via raw body inspection since they have a different schema.
	if objectType == pb.ObjectType_OBJECT_TYPE_ACTIVITY &&
		aspectType == pb.AspectType_ASPECT_TYPE_UPDATE &&
		len(raw.Updates) > 0 {
		event.Updates = parseActivityUpdates(raw.Updates)
	}

	return event, nil
}

// CoerceToString normalizes a decoded JSON value from Strava's `updates` map to a string.
// Strava documents string values ({"private":"true"}, {"authorized":"false"}) but has
// been observed to send a bare boolean ({"authorized":false}); tolerate both (plus a bare
// number) so one odd value can't reject the whole webhook — critically, a deauthorization.
// Returns false for shapes we don't understand (so the caller can skip that key, not fail).
func CoerceToString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return t, true
	case bool:
		return strconv.FormatBool(t), true
	case float64: // encoding/json decodes all JSON numbers to float64
		return strconv.FormatFloat(t, 'f', -1, 64), true
	default:
		return "", false
	}
}

// stringUpdate looks up a key in the updates map and coerces its value to a string,
// tolerating Strava's string/boolean/number shapes (see CoerceToString).
func stringUpdate(updates map[string]any, key string) (string, bool) {
	raw, ok := updates[key]
	if !ok {
		return "", false
	}
	return CoerceToString(raw)
}

// parseActivityUpdates converts Strava's updates map to typed ActivityUpdates.
func parseActivityUpdates(updates map[string]any) *pb.ActivityUpdates {
	if len(updates) == 0 {
		return nil
	}

	activityUpdates := &pb.ActivityUpdates{}

	if title, ok := stringUpdate(updates, "title"); ok {
		activityUpdates.Title = &title
	}

	if activityType, ok := stringUpdate(updates, "type"); ok {
		activityUpdates.Type = &activityType
	}

	if privateStr, ok := stringUpdate(updates, "private"); ok {
		private := privateStr == "true"
		activityUpdates.Private = &private
	}

	return activityUpdates
}

// parseAspectType converts Strava's string aspect_type to proto enum.
func parseAspectType(s string) (pb.AspectType, error) {
	switch s {
	case aspectCreate:
		return pb.AspectType_ASPECT_TYPE_CREATE, nil
	case aspectUpdate:
		return pb.AspectType_ASPECT_TYPE_UPDATE, nil
	case aspectDelete:
		return pb.AspectType_ASPECT_TYPE_DELETE, nil
	default:
		return pb.AspectType_ASPECT_TYPE_UNSPECIFIED, fmt.Errorf("invalid aspect_type: %s", s)
	}
}

// parseObjectType converts Strava's string object_type to proto enum.
func parseObjectType(s string) (pb.ObjectType, error) {
	switch s {
	case objectActivity:
		return pb.ObjectType_OBJECT_TYPE_ACTIVITY, nil
	case objectAthlete:
		return pb.ObjectType_OBJECT_TYPE_ATHLETE, nil
	default:
		return pb.ObjectType_OBJECT_TYPE_UNSPECIFIED, fmt.Errorf("invalid object_type: %s", s)
	}
}

// AspectTypeToString converts proto AspectType enum to Strava string format.
func AspectTypeToString(at pb.AspectType) string {
	switch at {
	case pb.AspectType_ASPECT_TYPE_CREATE:
		return aspectCreate
	case pb.AspectType_ASPECT_TYPE_UPDATE:
		return aspectUpdate
	case pb.AspectType_ASPECT_TYPE_DELETE:
		return aspectDelete
	default:
		return ""
	}
}

// ObjectTypeToString converts proto ObjectType enum to Strava string format.
func ObjectTypeToString(ot pb.ObjectType) string {
	switch ot {
	case pb.ObjectType_OBJECT_TYPE_ACTIVITY:
		return objectActivity
	case pb.ObjectType_OBJECT_TYPE_ATHLETE:
		return objectAthlete
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

	b, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal enriched event: %w", err)
	}
	return b, nil
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
		result["private"] = strconv.FormatBool(*updates.Private)
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
