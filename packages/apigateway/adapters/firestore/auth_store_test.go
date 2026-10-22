//go:build integration

package firestore

import (
	"context"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Integration tests need the Firestore emulator: set FIRESTORE_EMULATOR_HOST
// (e.g., "localhost:8080"). GCP_PROJECT_ID and FIRESTORE_DATABASE are optional.
// firestoretest.NewClient skips the tests without it (fails them in CI) before
// any client exists, so they can never reach a real project.
//
// Run with: go test -tags=integration ./adapters/firestore/

func newTestAuthStore(t *testing.T) *AuthStore {
	t.Helper()

	client := firestoretest.NewClient(t)

	return NewAuthStore(client, gcplog.NewNoOpLogger())
}

// athleteIDs makes each call to newAthleteID distinct within a run.
var athleteIDs atomic.Int64

// newAthleteID returns an athlete ID, as the number and the document key, that
// no earlier run used, so the tests can rerun against a long-lived emulator
// without reading a previous run's documents.
func newAthleteID() (int64, string) {
	id := time.Now().UnixNano() + athleteIDs.Add(1)
	return id, strconv.FormatInt(id, 10)
}

func TestAuthStore_WriteAuthData_HappyPath(t *testing.T) {
	store := newTestAuthStore(t)
	ctx := context.Background()
	stravaID, athleteID := newAthleteID()

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
		StravaAthleteID: stravaID,
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
	stravaID, athleteID := newAthleteID()

	// First login
	originalCreatedAt := time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC)
	firstProfile := &auth.AthleteProfile{
		StravaAthleteID: stravaID,
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
		StravaAthleteID: stravaID,
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
	stravaID, athleteID := newAthleteID()

	// First login — no existing profile, CreatedAt should be used as-is
	createdAt := time.Date(2026, 2, 20, 14, 0, 0, 0, time.UTC)
	profile := &auth.AthleteProfile{
		StravaAthleteID: stravaID,
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
