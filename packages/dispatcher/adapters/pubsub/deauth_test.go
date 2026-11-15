package pubsub

import (
	"bytes"
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"google.golang.org/protobuf/proto"
)

type deauthFixture struct {
	Event      json.RawMessage   `json:"event"`
	Attributes map[string]string `json:"attributes"`
}

func loadDeauthFixture(t *testing.T) deauthFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "schemas", "test-fixtures", "deletion_ownership.json")
	data, err := os.ReadFile(path) //nolint:gosec // Repository fixture relative to this test.
	if err != nil {
		t.Fatal(err)
	}
	var fixture deauthFixture
	if parseErr := json.Unmarshal(data, &fixture); parseErr != nil {
		t.Fatal(parseErr)
	}
	return fixture
}

func TestPublishDeauthBindsOwnerWithoutChangingBody(t *testing.T) {
	fixture := loadDeauthFixture(t)
	event, parseErr := webhookproto.ParseStravaWebhook(fixture.Event)
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	for _, test := range []struct {
		uid    string
		aspect generated.AspectType
	}{
		{fixture.Attributes["deletion_owner_uid"], generated.AspectType_ASPECT_TYPE_UPDATE},
		{"independent-uid", generated.AspectType_ASPECT_TYPE_UPDATE},
		{"67890", generated.AspectType_ASPECT_TYPE_UPDATE},
		{fixture.Attributes["deletion_owner_uid"], generated.AspectType_ASPECT_TYPE_DELETE},
		{"independent-uid", generated.AspectType_ASPECT_TYPE_DELETE},
		{"67890", generated.AspectType_ASPECT_TYPE_DELETE},
	} {
		t.Run(test.uid+"/"+test.aspect.String(), func(t *testing.T) {
			p, server := newTestPublisher(t)
			ctx := WithWebhookReceivedAt(context.Background(), time.UnixMilli(1234))
			event.AspectType = test.aspect
			owner := ports.CredentialOwner{UID: test.uid, Subject: event.OwnerId}
			enriched := &generated.EnrichedEvent{Event: event}
			if err := p.PublishDeauth(ctx, enriched, owner, "confirmed-grant"); err != nil {
				t.Fatal(err)
			}
			if err := p.Publish(ctx, enriched, "ordinary"); err != nil {
				t.Fatal(err)
			}
			if err := p.PublishRaw(ctx, []byte("raw-body"), "raw"); err != nil {
				t.Fatal(err)
			}
			messages := server.Messages()
			if len(messages) != 3 {
				t.Fatalf("published %d messages, want 3", len(messages))
			}
			if !bytes.Equal(messages[0].Data, messages[1].Data) {
				t.Fatal("deauth body differs from the existing envelope")
			}
			var published map[string]any
			if err := json.Unmarshal(messages[0].Data, &published); err != nil {
				t.Fatal(err)
			}
			var expectedBody map[string]any
			if err := json.Unmarshal(fixture.Event, &expectedBody); err != nil {
				t.Fatal(err)
			}
			expectedBody["aspect_type"] = webhookproto.AspectTypeToString(test.aspect)
			if !maps.Equal(published, expectedBody) {
				t.Fatalf("provider payload changed: %v", published)
			}
			want := maps.Clone(fixture.Attributes)
			want["deletion_owner_uid"] = test.uid
			want["correlation_id"], want["dispatcher_received_at_unix_ms"] = "confirmed-grant", "1234"
			if !maps.Equal(messages[0].Attributes, want) {
				t.Fatalf("attributes = %v, want %v", messages[0].Attributes, want)
			}
			for _, message := range messages[1:] {
				for key := range message.Attributes {
					if strings.HasPrefix(key, "deletion_owner_") {
						t.Fatalf("ownership leaked to unrelated publication: %s", key)
					}
				}
			}
		})
	}
}

func TestPublishDeauthRejectsUnboundEvents(t *testing.T) {
	owner := ports.CredentialOwner{UID: "independent-uid", Subject: 98765}
	for _, aspect := range []generated.AspectType{generated.AspectType_ASPECT_TYPE_UPDATE, generated.AspectType_ASPECT_TYPE_DELETE} {
		event := &generated.EnrichedEvent{Event: &generated.WebhookEvent{
			ObjectType: generated.ObjectType_OBJECT_TYPE_ATHLETE, AspectType: aspect, OwnerId: owner.Subject,
		}}
		for _, mutate := range []struct {
			name string
			fn   func(*generated.EnrichedEvent, *ports.CredentialOwner)
		}{
			{"empty UID", func(_ *generated.EnrichedEvent, o *ports.CredentialOwner) { o.UID = "" }},
			{"unsafe UID", func(_ *generated.EnrichedEvent, o *ports.CredentialOwner) { o.UID = "users/other" }},
			{"invalid subject", func(_ *generated.EnrichedEvent, o *ports.CredentialOwner) { o.Subject = 0 }},
			{"mismatched subject", func(_ *generated.EnrichedEvent, o *ports.CredentialOwner) { o.Subject++ }},
			{"missing event", func(e *generated.EnrichedEvent, _ *ports.CredentialOwner) { e.Event = nil }},
			{"activity event", func(e *generated.EnrichedEvent, _ *ports.CredentialOwner) {
				e.Event.ObjectType = generated.ObjectType_OBJECT_TYPE_ACTIVITY
			}},
			{"create event", func(e *generated.EnrichedEvent, _ *ports.CredentialOwner) {
				e.Event.AspectType = generated.AspectType_ASPECT_TYPE_CREATE
			}},
			{"activity payload", func(e *generated.EnrichedEvent, _ *ports.CredentialOwner) { e.RawActivity = []byte(`{}`) }},
		} {
			t.Run(strconv.Itoa(int(aspect))+"/"+mutate.name, func(t *testing.T) {
				p, server := newTestPublisher(t)
				candidate, ok := proto.Clone(event).(*generated.EnrichedEvent)
				if !ok {
					t.Fatal("unexpected cloned event type")
				}
				captured := owner
				mutate.fn(candidate, &captured)
				if err := p.PublishDeauth(context.Background(), candidate, captured, "test"); err == nil {
					t.Fatal("unbound deauth accepted")
				}
				if len(server.Messages()) != 0 {
					t.Fatal("rejected handoff reached Pub/Sub")
				}
			})
		}
	}
	p, server := newTestPublisher(t)
	if err := p.PublishDeauth(context.Background(), nil, owner, "test"); err == nil || len(server.Messages()) != 0 {
		t.Fatal("nil deauth must not publish")
	}
}
