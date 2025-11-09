package dispatcher

import (
	"fmt"
	"slices"
)

const (
	// AspectCreate represents a webhook event for creating a new resource
	AspectCreate = "create"
	// AspectUpdate represents a webhook event for updating an existing resource
	AspectUpdate = "update"
	// AspectDelete represents a webhook event for deleting a resource
	AspectDelete = "delete"

	// ObjectActivity represents an activity object in webhook events
	ObjectActivity = "activity"
	// ObjectAthlete represents an athlete object in webhook events
	ObjectAthlete = "athlete"
)

// WebhookRequest represents the Strava webhook payload structure
type WebhookRequest struct {
	Updates        map[string]any `json:"updates"`
	AspectType     string         `json:"aspect_type"`
	ObjectType     string         `json:"object_type"`
	EventTime      int64          `json:"event_time"`
	ObjectID       int64          `json:"object_id"`
	OwnerID        int64          `json:"owner_id"`
	SubscriptionID int            `json:"subscription_id"`
}

// Validate validates the webhook request fields
func (w *WebhookRequest) Validate() error {
	// Validate aspect_type
	validAspects := []string{AspectCreate, AspectUpdate, AspectDelete}
	if !slices.Contains(validAspects, w.AspectType) {
		return fmt.Errorf("invalid aspect_type: %s", w.AspectType)
	}

	// Validate object_type (accept both activity and athlete webhooks)
	validObjectTypes := []string{ObjectActivity, ObjectAthlete}
	if !slices.Contains(validObjectTypes, w.ObjectType) {
		return fmt.Errorf("invalid object_type: %s", w.ObjectType)
	}

	// Validate required fields
	if w.EventTime == 0 {
		return fmt.Errorf("event_time is required")
	}
	if w.ObjectID == 0 {
		return fmt.Errorf("object_id is required")
	}
	if w.OwnerID == 0 {
		return fmt.Errorf("owner_id is required")
	}
	if w.SubscriptionID == 0 {
		return fmt.Errorf("subscription_id is required")
	}

	return nil
}
