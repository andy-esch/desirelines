//go:build integration

package allowlist

import (
	"context"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Integration tests need the Firestore emulator: set FIRESTORE_EMULATOR_HOST
// (e.g., "localhost:8080"). GCP_PROJECT_ID and FIRESTORE_DATABASE are optional.
// firestoretest.NewClient skips the tests without it (fails them in CI) before
// any client exists, so they can never reach a real project.
//
// Run with: go test -tags=integration ./packages/shared/allowlist/

func newTestChecker(t *testing.T) (*FirestoreChecker, *firestore.Client) {
	t.Helper()

	client := firestoretest.NewClient(t)

	return NewFirestoreChecker(client, gcplog.NewNoOpLogger()), client
}

func seedAllowlist(t *testing.T, client *firestore.Client, athleteID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := client.Collection(stravatoken.AllowlistCollection).Doc(athleteID).Set(ctx, map[string]any{
		"added_at": time.Now(),
	}); err != nil {
		t.Fatalf("seedAllowlist() error = %v", err)
	}
}

func TestFirestoreChecker_IsAllowed_Exists(t *testing.T) {
	checker, client := newTestChecker(t)
	ctx := context.Background()

	seedAllowlist(t, client, "111111")

	allowed, err := checker.IsAllowed(ctx, "111111")
	if err != nil {
		t.Fatalf("IsAllowed() error = %v", err)
	}
	if !allowed {
		t.Error("IsAllowed() = false, want true for seeded athlete")
	}
}

func TestFirestoreChecker_IsAllowed_NotFound(t *testing.T) {
	checker, _ := newTestChecker(t)
	ctx := context.Background()

	allowed, err := checker.IsAllowed(ctx, "999999")
	if err != nil {
		t.Fatalf("IsAllowed() error = %v", err)
	}
	if allowed {
		t.Error("IsAllowed() = true, want false for non-existent athlete")
	}
}
