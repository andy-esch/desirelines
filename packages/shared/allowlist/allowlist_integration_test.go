//go:build integration

package allowlist

import (
	"context"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Integration tests require:
// - FIRESTORE_EMULATOR_HOST set (e.g., "localhost:8080")
// - GCP_PROJECT_ID set (any value works with emulator)
// - FIRESTORE_DATABASE set (any value works with emulator)
//
// Run with: go test -tags=integration ./packages/shared/allowlist/

func newTestChecker(t *testing.T) (*FirestoreChecker, *firestore.Client) {
	t.Helper()

	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "test-project"
	}
	database := os.Getenv("FIRESTORE_DATABASE")
	if database == "" {
		database = "test-db"
	}

	ctx := context.Background()
	client, err := firestore.NewClientWithDatabase(ctx, projectID, database)
	if err != nil {
		t.Fatalf("failed to create Firestore client: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Errorf("failed to close Firestore client: %v", closeErr)
		}
	})

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
