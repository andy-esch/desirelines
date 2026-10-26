//go:build integration

package connectionbootstrap

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
)

func TestMissingLegacyDocumentsBlockEligibility(t *testing.T) {
	t.Setenv("FIRESTORE_DATABASE", fmt.Sprintf("inventory-health-%d", time.Now().UnixNano()))
	db := firestoretest.NewClient(t)
	ctx := context.Background()
	user := db.Collection("users").Doc("111")
	users := map[string]*firebaseauth.ExportedUserRecord{"111": {}, "222": {}}
	allowed := map[string]bool{"111": true, "222": true}
	if _, seedErr := user.Collection("private").Doc("profile").Set(ctx, map[string]any{"strava_athlete_id": int64(111)}); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory := Inventory{Candidates: []string{"111", "222"}}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil {
		t.Fatal(scanErr)
	}
	missing := map[string]bool{}
	for _, issue := range inventory.Issues {
		if issue.Blocking && strings.Contains(issue.Reason, "missing legacy") {
			missing[issue.UID] = true
		}
	}
	if !missing["111"] || !missing["222"] {
		t.Fatalf("incomplete legacy state accepted: %+v", inventory.Issues)
	}
	if _, seedErr := user.Collection("private").Doc("strava_tokens").Set(ctx, map[string]any{"secret": "not-inventory-data"}); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory = Inventory{Candidates: []string{"111"}}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil {
		t.Fatal(scanErr)
	}
	if len(inventory.Issues) != 0 {
		t.Fatalf("healthy identity blocked: %+v", inventory.Issues)
	}
}

func TestInventoryReportsHalfAndMalformedRegistryPairs(t *testing.T) {
	t.Setenv("FIRESTORE_DATABASE", fmt.Sprintf("inventory-pairs-%d", time.Now().UnixNano()))
	db := firestoretest.NewClient(t)
	ctx := context.Background()
	users := map[string]*firebaseauth.ExportedUserRecord{"111": {}}
	allowed := map[string]bool{"111": true}
	connection := db.Collection("users").Doc("111").Collection("connections").Doc("strava")
	record := Record("111", "operation")
	if _, seedErr := connection.Set(ctx, record); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory := Inventory{}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil {
		t.Fatal(scanErr)
	}
	if len(inventory.Issues) != 1 || inventory.Issues[0].UID != "111" || !inventory.Issues[0].Blocking {
		t.Fatalf("connection-only pair missed: %+v", inventory.Issues)
	}
	lookup := db.Collection("provider_accounts").Doc("strava:111")
	if _, seedErr := lookup.Set(ctx, map[string]any{"subject": []string{"111"}}); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory = Inventory{}
	if scanErr := inventory.checkRegistry(ctx, db, users, allowed); scanErr != nil {
		t.Fatalf("malformed metadata aborted inventory: %v", scanErr)
	}
	if len(inventory.Issues) != 1 || inventory.Issues[0].UID != "strava:111" || !inventory.Issues[0].Blocking {
		t.Fatalf("malformed lookup not identified: %+v", inventory.Issues)
	}
	if _, seedErr := lookup.Set(ctx, record); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory = Inventory{}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil || len(inventory.Issues) != 0 {
		t.Fatalf("matching pair blocked: %+v %v", inventory.Issues, scanErr)
	}
}
