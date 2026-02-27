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

// seedTokens writes a full token document directly via Set, simulating what
// apigateway does during OAuth. This ensures the document exists before
// WriteTokensIfUnmodified (which uses Update inside a transaction) is called.
func seedTokens(t *testing.T, store *TokenStore, athleteID int64, tokens *stravatoken.Data) {
	t.Helper()
	ctx := context.Background()
	if _, err := store.tokensRef(athleteID).Set(ctx, tokens); err != nil {
		t.Fatalf("seedTokens() error = %v", err)
	}
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

func TestTokenStore_WriteIfUnmodifiedAndRead(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	athleteID := int64(12345)

	// Seed the document first (simulates apigateway OAuth write).
	seedTime := time.Now().Add(-1 * time.Hour).Truncate(time.Millisecond)
	initial := &stravatoken.Data{
		AccessToken:   "initial-access",
		RefreshToken:  "initial-refresh",
		ExpiresAt:     time.Now().Add(6 * time.Hour).Unix(),
		Scopes:        "read,activity:read_all",
		ConnectedAt:   time.Now().Truncate(time.Millisecond),
		LastRefreshed: seedTime,
	}
	seedTokens(t, store, athleteID, initial)

	// WriteTokensIfUnmodified updates only the dispatcher-owned fields.
	refreshed := &stravatoken.Data{
		AccessToken:  "test-access",
		RefreshToken: "test-refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
	}

	if err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed, seedTime); err != nil {
		t.Fatalf("WriteTokensIfUnmodified() error = %v", err)
	}

	got, err := store.GetTokens(ctx, athleteID)
	if err != nil {
		t.Fatalf("GetTokens() error = %v", err)
	}

	if got.AccessToken != refreshed.AccessToken {
		t.Errorf("AccessToken = %s, want %s", got.AccessToken, refreshed.AccessToken)
	}
	if got.RefreshToken != refreshed.RefreshToken {
		t.Errorf("RefreshToken = %s, want %s", got.RefreshToken, refreshed.RefreshToken)
	}
	if got.LastRefreshed.IsZero() {
		t.Error("LastRefreshed should be set after WriteTokensIfUnmodified")
	}
}

func TestTokenStore_WriteIfUnmodified_PreservesOAuthFields(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	athleteID := int64(67890)

	// Seed a full token document as apigateway would during OAuth.
	connectedAt := time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)
	seedTime := time.Now().Add(-1 * time.Hour).Truncate(time.Millisecond)
	initial := &stravatoken.Data{
		AccessToken:   "oauth-access",
		RefreshToken:  "oauth-refresh",
		ExpiresAt:     time.Now().Add(6 * time.Hour).Unix(),
		Scopes:        "activity:read_all",
		ConnectedAt:   connectedAt,
		LastRefreshed: seedTime,
	}
	seedTokens(t, store, athleteID, initial)

	// Dispatcher refreshes tokens — only access_token, refresh_token,
	// expires_at, and last_refreshed should change.
	refreshed := &stravatoken.Data{
		AccessToken:  "refreshed-access",
		RefreshToken: "refreshed-refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
		// Scopes and ConnectedAt are intentionally zero-valued here,
		// simulating what the dispatcher passes after a Strava token refresh.
	}

	if err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed, seedTime); err != nil {
		t.Fatalf("WriteTokensIfUnmodified() error = %v", err)
	}

	got, err := store.GetTokens(ctx, athleteID)
	if err != nil {
		t.Fatalf("GetTokens() error = %v", err)
	}

	// Verify dispatcher-owned fields were updated.
	if got.AccessToken != refreshed.AccessToken {
		t.Errorf("AccessToken = %s, want %s", got.AccessToken, refreshed.AccessToken)
	}
	if got.RefreshToken != refreshed.RefreshToken {
		t.Errorf("RefreshToken = %s, want %s", got.RefreshToken, refreshed.RefreshToken)
	}
	if got.ExpiresAt != refreshed.ExpiresAt {
		t.Errorf("ExpiresAt = %d, want %d", got.ExpiresAt, refreshed.ExpiresAt)
	}
	if got.LastRefreshed.IsZero() {
		t.Error("LastRefreshed should be set after WriteTokensIfUnmodified")
	}

	// Verify apigateway-owned fields were NOT overwritten.
	if got.Scopes != initial.Scopes {
		t.Errorf("Scopes = %q, want %q (should be preserved)", got.Scopes, initial.Scopes)
	}
	if !got.ConnectedAt.Equal(connectedAt) {
		t.Errorf("ConnectedAt = %v, want %v (should be preserved)", got.ConnectedAt, connectedAt)
	}
}

func TestTokenStore_WriteIfUnmodified_Conflict(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	athleteID := int64(11111)

	seedTime := time.Now().Add(-1 * time.Hour).Truncate(time.Millisecond)
	initial := &stravatoken.Data{
		AccessToken:   "access",
		RefreshToken:  "refresh",
		ExpiresAt:     time.Now().Add(6 * time.Hour).Unix(),
		LastRefreshed: seedTime,
	}
	seedTokens(t, store, athleteID, initial)

	// Write with a stale version stamp — should conflict.
	staleTime := seedTime.Add(-10 * time.Minute)
	refreshed := &stravatoken.Data{
		AccessToken:  "should-not-persist",
		RefreshToken: "should-not-persist",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
	}

	err := store.WriteTokensIfUnmodified(ctx, athleteID, refreshed, staleTime)
	if err == nil {
		t.Fatal("expected ErrTokenConflict for stale version stamp")
	}
	if err != ports.ErrTokenConflict {
		t.Errorf("expected ErrTokenConflict, got %v", err)
	}

	// Verify original tokens are unchanged.
	got, err := store.GetTokens(ctx, athleteID)
	if err != nil {
		t.Fatalf("GetTokens() error = %v", err)
	}
	if got.AccessToken != initial.AccessToken {
		t.Errorf("AccessToken = %s, want %s (should be unchanged after conflict)", got.AccessToken, initial.AccessToken)
	}
}
