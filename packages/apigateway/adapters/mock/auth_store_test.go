package mock

import (
	"context"
	"errors"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

func TestConnectionResolverUsesOnlyConfiguredFixture(t *testing.T) {
	owner := activityconnection.Record{SchemaVersion: 1, UID: "local-app-uid", Provider: "strava", Subject: "123", Scopes: []string{}, Status: "active", Provenance: "dev_fixture"}
	resolver := ConnectionResolver{Owner: owner}
	got, err := resolver.Resolve(context.Background(), "123")
	if err != nil || got.UID != owner.UID {
		t.Fatalf("fixture resolution = %+v, %v", got, err)
	}
	if _, missingErr := resolver.Resolve(context.Background(), "456"); !errors.Is(missingErr, activityconnection.ErrNotFound) {
		t.Fatalf("unconfigured subject resolved: %v", missingErr)
	}
	owner.Status = "disconnected"
	if _, inactiveErr := (&ConnectionResolver{Owner: owner}).Resolve(context.Background(), "123"); !errors.Is(inactiveErr, activityconnection.ErrNotFound) {
		t.Fatalf("inactive fixture resolved: %v", inactiveErr)
	}
	if _, invalidErr := (&ConnectionResolver{}).Resolve(context.Background(), "123"); !errors.Is(invalidErr, activityconnection.ErrConflict) {
		t.Fatalf("invalid fixture resolved: %v", invalidErr)
	}
}
