package dispatcher

import (
	"fmt"
)

// AspectType represents the type of change in a webhook event.
type AspectType string

const (
	// AspectCreate represents a webhook event for creating a new resource
	AspectCreate AspectType = "create"
	// AspectUpdate represents a webhook event for updating an existing resource
	AspectUpdate AspectType = "update"
	// AspectDelete represents a webhook event for deleting a resource
	AspectDelete AspectType = "delete"
)

// Valid returns true if the AspectType is valid.
func (a AspectType) Valid() bool {
	switch a {
	case AspectCreate, AspectUpdate, AspectDelete:
		return true
	default:
		return false
	}
}

// String returns the string representation of AspectType.
func (a AspectType) String() string {
	return string(a)
}

// ObjectType represents the type of Strava object in a webhook event.
type ObjectType string

const (
	// ObjectActivity represents an activity object in webhook events
	ObjectActivity ObjectType = "activity"
	// ObjectAthlete represents an athlete object in webhook events
	ObjectAthlete ObjectType = "athlete"
)

// Valid returns true if the ObjectType is valid.
func (o ObjectType) Valid() bool {
	switch o {
	case ObjectActivity, ObjectAthlete:
		return true
	default:
		return false
	}
}

// String returns the string representation of ObjectType.
func (o ObjectType) String() string {
	return string(o)
}

// WebhookRequest represents the Strava webhook payload structure
type WebhookRequest struct {
	Updates        map[string]any `json:"updates"`
	AspectType     AspectType     `json:"aspect_type"`
	ObjectType     ObjectType     `json:"object_type"`
	EventTime      int64          `json:"event_time"`
	ObjectID       int64          `json:"object_id"`
	OwnerID        int64          `json:"owner_id"`
	SubscriptionID int            `json:"subscription_id"`
}

// Validate validates the webhook request fields
func (w *WebhookRequest) Validate() error {
	// Validate aspect_type using type-safe method
	if !w.AspectType.Valid() {
		return fmt.Errorf("invalid aspect_type: %s", w.AspectType)
	}

	// Validate object_type using type-safe method
	if !w.ObjectType.Valid() {
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
