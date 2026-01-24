// Package proto provides conversion between Strava's JSON webhook format and protobuf.
//
// This adapter handles the translation layer between Strava's webhook JSON
// payloads and the internal protobuf representation used for Pub/Sub messaging.
//
// # Parsing Webhooks
//
// Convert incoming JSON to protobuf:
//
//	event, err := proto.ParseStravaWebhook(jsonData)
//	if err != nil {
//	    // Handle parse error
//	}
//
// # Validation
//
// Validate webhook events before processing:
//
//	if err := proto.Validate(event); err != nil {
//	    // Handle validation error
//	}
//
// Validation ensures:
//   - object_id is present and positive
//   - owner_id is present and positive
//   - aspect_type is valid (create, update, delete)
//   - object_type is valid (activity, athlete)
//
// # Serialization
//
// Convert protobuf back to JSON for publishing:
//
//	jsonData, err := proto.ToStravaJSON(event)
//
// [ToStravaJSON] outputs string enum values ("create", "activity") rather than
// numeric values, maintaining compatibility with downstream Python consumers.
//
// # Strava Webhook Format
//
// Strava webhooks have this structure:
//
//	{
//	    "object_type": "activity",       // "activity" or "athlete"
//	    "object_id": 1234567890,         // Strava activity/athlete ID
//	    "aspect_type": "create",         // "create", "update", or "delete"
//	    "owner_id": 12345,               // Strava athlete ID
//	    "subscription_id": 67890,        // Webhook subscription ID
//	    "event_time": 1640000000,        // Unix timestamp
//	    "updates": {"title": "New Run"}  // Only for "update" aspect_type
//	}
//
// # Helper Functions
//
// Convert enum values to strings:
//
//	aspectStr := proto.AspectTypeToString(event.AspectType)  // "create"
//	objectStr := proto.ObjectTypeToString(event.ObjectType)  // "activity"
package proto
