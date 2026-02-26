//go:build integration

package firestore

import (
	"context"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Integration tests require:
// - FIRESTORE_EMULATOR_HOST set (e.g., "localhost:8080")
// - GCP_PROJECT_ID set (any value works with emulator)
// - FIRESTORE_DATABASE set (any value works with emulator)
//
// Run with: go test -tags=integration ./adapters/firestore/

func newTestStore(t *testing.T) *TokenStore {
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

	return NewTokenStore(client, gcplog.NewNoOpLogger())
}

func TestTokenStore_GetTokens_NotFound(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	_, err := store.GetTokens(ctx, 999999)
	if err == nil {
		t.Fatal("expected error for non-existent athlete")
	}
	if err != ports.ErrTokenNotFound {
		t.Errorf("expected ErrTokenNotFound, got %v", err)
	}
}

func TestTokenStore_WriteAndRead(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	athleteID := int64(12345)

	tokens := &stravatoken.Data{
		AccessToken:  "test-access",
		RefreshToken: "test-refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
		Scopes:       "read,activity:read_all",
		ConnectedAt:  time.Now().Truncate(time.Millisecond),
	}

	if err := store.WriteTokens(ctx, athleteID, tokens); err != nil {
		t.Fatalf("WriteTokens() error = %v", err)
	}

	got, err := store.GetTokens(ctx, athleteID)
	if err != nil {
		t.Fatalf("GetTokens() error = %v", err)
	}

	if got.AccessToken != tokens.AccessToken {
		t.Errorf("AccessToken = %s, want %s", got.AccessToken, tokens.AccessToken)
	}
	if got.RefreshToken != tokens.RefreshToken {
		t.Errorf("RefreshToken = %s, want %s", got.RefreshToken, tokens.RefreshToken)
	}
	if got.LastRefreshed.IsZero() {
		t.Error("LastRefreshed should be set after WriteTokens")
	}
}
