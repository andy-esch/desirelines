//go:build integration

package firestore

import (
	"context"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Integration tests require:
// - FIRESTORE_EMULATOR_HOST set (e.g., "localhost:8080")
// - GCP_PROJECT_ID set (any value works with emulator)
// - FIRESTORE_DATABASE set (any value works with emulator)
//
// Run with: go test -tags=integration ./adapters/firestore/

func newTestAuthStore(t *testing.T) *AuthStore {
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

	return NewAuthStore(client, gcplog.NewNoOpLogger())
}

func TestAuthStore_WriteAuthData_HappyPath(t *testing.T) {
	store := newTestAuthStore(t)
	ctx := context.Background()
	athleteID := "222222"

	now := time.Now().Truncate(time.Millisecond)
	tokens := &stravatoken.Data{
		AccessToken:   "test-access",
		RefreshToken:  "test-refresh",
		ExpiresAt:     now.Add(6 * time.Hour).Unix(),
		Scopes:        "read,activity:read_all",
		ConnectedAt:   now,
		LastRefreshed: now,
	}
	profile := &auth.AthleteProfile{
		StravaAthleteID: 222222,
		FirstName:       "Test",
		LastName:        "User",
		ProfileURL:      "https://example.com/avatar.jpg",
		CreatedAt:       now,
	}

	if err := store.WriteAuthData(ctx, athleteID, tokens, profile); err != nil {
		t.Fatalf("WriteAuthData() error = %v", err)
	}

	// Read back tokens
	userPrivate := store.client.Collection(stravatoken.UsersCollection).Doc(athleteID).Collection(stravatoken.PrivateCollection)

	tokensDoc, err := userPrivate.Doc(stravatoken.TokensDocument).Get(ctx)
	if err != nil {
		t.Fatalf("failed to read tokens doc: %v", err)
	}
	var gotTokens stravatoken.Data
	if err := tokensDoc.DataTo(&gotTokens); err != nil {
		t.Fatalf("failed to decode tokens: %v", err)
	}
	if gotTokens.AccessToken != tokens.AccessToken {
		t.Errorf("AccessToken = %q, want %q", gotTokens.AccessToken, tokens.AccessToken)
	}
	if gotTokens.RefreshToken != tokens.RefreshToken {
		t.Errorf("RefreshToken = %q, want %q", gotTokens.RefreshToken, tokens.RefreshToken)
	}
	if gotTokens.Scopes != tokens.Scopes {
		t.Errorf("Scopes = %q, want %q", gotTokens.Scopes, tokens.Scopes)
	}

	// Read back profile
	profileDoc, err := userPrivate.Doc(stravatoken.ProfileDocument).Get(ctx)
	if err != nil {
		t.Fatalf("failed to read profile doc: %v", err)
	}
	var gotProfile auth.AthleteProfile
	if err := profileDoc.DataTo(&gotProfile); err != nil {
		t.Fatalf("failed to decode profile: %v", err)
	}
	if gotProfile.StravaAthleteID != profile.StravaAthleteID {
		t.Errorf("StravaAthleteID = %d, want %d", gotProfile.StravaAthleteID, profile.StravaAthleteID)
	}
	if gotProfile.FirstName != profile.FirstName {
		t.Errorf("FirstName = %q, want %q", gotProfile.FirstName, profile.FirstName)
	}
	if gotProfile.LastName != profile.LastName {
		t.Errorf("LastName = %q, want %q", gotProfile.LastName, profile.LastName)
	}
	if gotProfile.ProfileURL != profile.ProfileURL {
		t.Errorf("ProfileURL = %q, want %q", gotProfile.ProfileURL, profile.ProfileURL)
	}
	if !gotProfile.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", gotProfile.CreatedAt, now)
	}
}

func TestAuthStore_WriteAuthData_PreservesCreatedAt(t *testing.T) {
	store := newTestAuthStore(t)
	ctx := context.Background()
	athleteID := "333333"

	// First login
	originalCreatedAt := time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)
	firstProfile := &auth.AthleteProfile{
		StravaAthleteID: 333333,
		FirstName:       "First",
		LastName:        "Login",
		CreatedAt:       originalCreatedAt,
	}
	firstTokens := &stravatoken.Data{
		AccessToken:  "first-access",
		RefreshToken: "first-refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
		Scopes:       "read,activity:read_all",
	}

	if err := store.WriteAuthData(ctx, athleteID, firstTokens, firstProfile); err != nil {
		t.Fatalf("first WriteAuthData() error = %v", err)
	}

	// Re-login with updated profile but different CreatedAt
	reloginProfile := &auth.AthleteProfile{
		StravaAthleteID: 333333,
		FirstName:       "Updated",
		LastName:        "Name",
		ProfileURL:      "https://example.com/new-avatar.jpg",
		CreatedAt:       time.Now(), // This should be overwritten with the original
	}
	reloginTokens := &stravatoken.Data{
		AccessToken:  "new-access",
		RefreshToken: "new-refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
		Scopes:       "read,activity:read_all",
	}

	if err := store.WriteAuthData(ctx, athleteID, reloginTokens, reloginProfile); err != nil {
		t.Fatalf("re-login WriteAuthData() error = %v", err)
	}

	// Read back profile — CreatedAt should be preserved from first login
	userPrivate := store.client.Collection(stravatoken.UsersCollection).Doc(athleteID).Collection(stravatoken.PrivateCollection)
	profileDoc, err := userPrivate.Doc(stravatoken.ProfileDocument).Get(ctx)
	if err != nil {
		t.Fatalf("failed to read profile doc: %v", err)
	}
	var gotProfile auth.AthleteProfile
	if err := profileDoc.DataTo(&gotProfile); err != nil {
		t.Fatalf("failed to decode profile: %v", err)
	}

	if !gotProfile.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("CreatedAt = %v, want %v (should be preserved from first login)", gotProfile.CreatedAt, originalCreatedAt)
	}
	if gotProfile.FirstName != "Updated" {
		t.Errorf("FirstName = %q, want %q (should be updated on re-login)", gotProfile.FirstName, "Updated")
	}
	if gotProfile.ProfileURL != "https://example.com/new-avatar.jpg" {
		t.Errorf("ProfileURL = %q, want updated value", gotProfile.ProfileURL)
	}

	// Tokens should also be updated
	tokensDoc, err := userPrivate.Doc(stravatoken.TokensDocument).Get(ctx)
	if err != nil {
		t.Fatalf("failed to read tokens doc: %v", err)
	}
	var gotTokens stravatoken.Data
	if err := tokensDoc.DataTo(&gotTokens); err != nil {
		t.Fatalf("failed to decode tokens: %v", err)
	}
	if gotTokens.AccessToken != "new-access" {
		t.Errorf("AccessToken = %q, want %q", gotTokens.AccessToken, "new-access")
	}
}

func TestAuthStore_WriteAuthData_FirstLogin(t *testing.T) {
	store := newTestAuthStore(t)
	ctx := context.Background()
	athleteID := "444444"

	// First login — no existing profile, CreatedAt should be used as-is
	createdAt := time.Date(2026, 2, 20, 14, 0, 0, 0, time.UTC)
	profile := &auth.AthleteProfile{
		StravaAthleteID: 444444,
		FirstName:       "New",
		LastName:        "User",
		CreatedAt:       createdAt,
	}
	tokens := &stravatoken.Data{
		AccessToken:  "access",
		RefreshToken: "refresh",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
	}

	if err := store.WriteAuthData(ctx, athleteID, tokens, profile); err != nil {
		t.Fatalf("WriteAuthData() error = %v", err)
	}

	userPrivate := store.client.Collection(stravatoken.UsersCollection).Doc(athleteID).Collection(stravatoken.PrivateCollection)
	profileDoc, err := userPrivate.Doc(stravatoken.ProfileDocument).Get(ctx)
	if err != nil {
		t.Fatalf("failed to read profile doc: %v", err)
	}
	var gotProfile auth.AthleteProfile
	if err := profileDoc.DataTo(&gotProfile); err != nil {
		t.Fatalf("failed to decode profile: %v", err)
	}

	if !gotProfile.CreatedAt.Equal(createdAt) {
		t.Errorf("CreatedAt = %v, want %v (should use provided value on first login)", gotProfile.CreatedAt, createdAt)
	}
}
