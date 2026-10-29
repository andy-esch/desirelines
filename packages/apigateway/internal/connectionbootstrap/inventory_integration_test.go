//go:build integration

package connectionbootstrap

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
)

func TestMissingLegacyDocumentsRequireReview(t *testing.T) {
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
	want := map[string][]string{"111": {"strava_tokens"}, "222": {"profile", "strava_tokens"}}
	if !reflect.DeepEqual(inventory.MissingLegacyDocuments, want) || len(inventory.Issues) != 0 {
		t.Fatalf("missing document paths not reported: %+v", inventory)
	}
	if _, seedErr := user.Collection("private").Doc("strava_tokens").Set(ctx, map[string]any{"secret": "not-inventory-data"}); seedErr != nil {
		t.Fatal(seedErr)
	}
	inventory = Inventory{Candidates: []string{"111"}}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil {
		t.Fatal(scanErr)
	}
	if len(inventory.Issues) != 0 || len(inventory.MissingLegacyDocuments) != 0 {
		t.Fatalf("healthy identity blocked: %+v", inventory)
	}
	if _, deleteErr := user.Collection("private").Doc("profile").Delete(ctx); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	inventory = Inventory{Candidates: []string{"111"}}
	if scanErr := inventory.checkUserDocuments(ctx, db, users, allowed); scanErr != nil {
		t.Fatal(scanErr)
	}
	if !reflect.DeepEqual(inventory.MissingLegacyDocuments, map[string][]string{"111": {"profile"}}) {
		t.Fatalf("missing profile not reported: %+v", inventory)
	}
}

func TestMissingCredentialsDoNotHideProfileMismatch(t *testing.T) {
	t.Setenv("FIRESTORE_DATABASE", fmt.Sprintf("inventory-profile-%d", time.Now().UnixNano()))
	db := firestoretest.NewClient(t)
	ctx := context.Background()
	if _, err := db.Collection("users").Doc("111").Collection("private").Doc("profile").Set(ctx, map[string]any{"strava_athlete_id": int64(222)}); err != nil {
		t.Fatal(err)
	}
	inventory := Inventory{Candidates: []string{"111"}}
	if err := inventory.checkUserDocuments(ctx, db, map[string]*firebaseauth.ExportedUserRecord{"111": {}}, map[string]bool{"111": true}); err != nil {
		t.Fatal(err)
	}
	if len(inventory.Issues) != 1 || !inventory.Issues[0].Blocking || inventory.Issues[0].Reason != "untrusted profile subject mismatch; not ownership evidence" {
		t.Fatalf("profile mismatch not blocked: %+v", inventory)
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

func TestInventoryBlocksOrphanUserPaths(t *testing.T) {
	t.Setenv("FIRESTORE_DATABASE", fmt.Sprintf("inventory-orphans-%d", time.Now().UnixNano()))
	db := firestoretest.NewClient(t)
	ctx := context.Background()
	for _, uid := range []string{"111", "222"} {
		if _, seedErr := db.Collection("users").Doc(uid).Collection("config").Doc("v1").Set(ctx, map[string]any{}); seedErr != nil {
			t.Fatal(seedErr)
		}
	}
	// One UID has Auth without admission; the other admission without Auth.
	inventory := Inventory{}
	if scanErr := inventory.checkUserDocuments(ctx, db, map[string]*firebaseauth.ExportedUserRecord{"111": {}}, map[string]bool{"222": true}); scanErr != nil {
		t.Fatal(scanErr)
	}
	blocked := map[string]bool{}
	for _, issue := range inventory.Issues {
		blocked[issue.UID] = issue.Blocking && issue.Reason == "orphan Firestore user paths"
	}
	if len(inventory.Issues) != 2 || !blocked["111"] || !blocked["222"] {
		t.Fatalf("orphan paths were not blocked: %+v", inventory.Issues)
	}
}
