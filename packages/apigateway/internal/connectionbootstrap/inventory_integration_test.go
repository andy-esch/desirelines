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
