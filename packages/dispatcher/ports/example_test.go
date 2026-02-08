package ports_test

import (
	"context"
	"fmt"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
)

func ExamplePublisher() {
	// In production, use pubsub.NewPublisher
	// For testing, use the mock:
	publisher := &portstest.MockPublisher{}

	enriched := &generated.EnrichedEvent{
		Event: &generated.WebhookEvent{
			ObjectId:   123456789,
			OwnerId:    12345,
			AspectType: generated.AspectType_ASPECT_TYPE_CREATE,
			ObjectType: generated.ObjectType_OBJECT_TYPE_ACTIVITY,
		},
		RawActivity: []byte(`{"id":123456789,"name":"Morning Run"}`),
	}

	err := publisher.Publish(context.Background(), enriched, "correlation-123")
	if err != nil {
		fmt.Println("publish failed:", err)
		return
	}

	// Verify the mock received the call
	fmt.Println("published events:", len(publisher.Published))
	fmt.Println("object_id:", publisher.Published[0].Event.ObjectId)
	// Output:
	// published events: 1
	// object_id: 123456789
}

func ExampleSecretProvider() {
	// In production, use env.NewDefaultSecretCache
	// For testing, use the mock:
	secretProvider := &portstest.MockSecretProvider{
		VerifyToken:    "my-verify-token",
		SubscriptionID: 12345,
	}

	token, subID, err := secretProvider.GetSecrets()
	if err != nil {
		fmt.Println("error:", err)
		return
	}

	fmt.Println("token:", token)
	fmt.Println("subscription_id:", subID)
	// Output:
	// token: my-verify-token
	// subscription_id: 12345
}

// customPublisher shows how to implement the Publisher interface
type customPublisher struct {
	events []*generated.EnrichedEvent
}

func (p *customPublisher) Publish(_ context.Context, enriched *generated.EnrichedEvent, _ string) error {
	p.events = append(p.events, enriched)
	return nil
}

func (p *customPublisher) Close(_ context.Context) error {
	p.events = nil
	return nil
}

// Verify customPublisher implements Publisher at compile time
var _ ports.Publisher = (*customPublisher)(nil)

func Example_customPublisher() {
	// Implement the Publisher interface for custom backends
	publisher := &customPublisher{}

	enriched := &generated.EnrichedEvent{
		Event: &generated.WebhookEvent{ObjectId: 999},
	}
	if err := publisher.Publish(context.Background(), enriched, "id"); err != nil {
		fmt.Println("error:", err)
	}

	fmt.Println("custom publisher received:", len(publisher.events), "events")
	// Output: custom publisher received: 1 events
}
