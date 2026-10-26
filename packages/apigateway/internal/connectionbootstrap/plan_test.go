package connectionbootstrap

import (
	"context"
	"reflect"
	"testing"

	firebaseauth "firebase.google.com/go/v4/auth"
)

func TestReviewRejectsUntrustedAndDriftedOwners(t *testing.T) {
	inventory := Inventory{Project: "demo-test-project", Database: "test", PostgresTarget: "localhost:5432/test", Candidates: []string{"111"}, Issues: []Issue{{"222", "allowlist-only", false}}}
	manifest := Manifest{Project: "demo-test-project", Database: "test", PostgresTarget: "localhost:5432/test", OperationID: "test-1", ReviewedLegacyUIDs: true, UIDs: []string{"111"}, Excluded: map[string]string{"222": "not previously enrolled; admission remains frozen"}}
	if err := Review(&inventory, &manifest); err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*Inventory, *Manifest){
		"no attestation":         func(_ *Inventory, m *Manifest) { m.ReviewedLegacyUIDs = false },
		"wrong Postgres":         func(_ *Inventory, m *Manifest) { m.PostgresTarget = "other:5432/test" },
		"wrong project":          func(_ *Inventory, m *Manifest) { m.Project = "other" },
		"new candidate":          func(i *Inventory, _ *Manifest) { i.Candidates = append(i.Candidates, "333") },
		"profile tampering":      func(i *Inventory, _ *Manifest) { i.Issues = append(i.Issues, Issue{"111", "profile claims 222", true}) },
		"unresolved orphan":      func(i *Inventory, _ *Manifest) { i.Issues = append(i.Issues, Issue{"444", "orphan", true}) },
		"claim excluded subject": func(_ *Inventory, m *Manifest) { m.UIDs = append(m.UIDs, "222") },
		"unsafe operation":       func(_ *Inventory, m *Manifest) { m.OperationID = "../x" },
		"ambiguous subject":      func(_ *Inventory, m *Manifest) { m.UIDs = []string{"0111"} },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			i, m := inventory, manifest
			mutate(&i, &m)
			if err := Review(&i, &m); err == nil {
				t.Fatal("unsafe inventory accepted")
			}
		})
	}
}

func TestManifestDispositionsMustMatchInventory(t *testing.T) {
	inventory := Inventory{Project: "demo-test-project", Database: "test", PostgresTarget: "localhost:5432/test", Candidates: []string{"111"}}
	valid := func() Manifest {
		return Manifest{Project: inventory.Project, Database: inventory.Database, PostgresTarget: inventory.PostgresTarget, OperationID: "operation", ReviewedLegacyUIDs: true, UIDs: []string{"111"}}
	}
	for name, mutate := range map[string]func(*Manifest){
		"duplicate UID":             func(m *Manifest) { m.UIDs = append(m.UIDs, "111") },
		"empty exclusion":           func(m *Manifest) { m.Excluded = map[string]string{"222": ""} },
		"empty exclusion key":       func(m *Manifest) { m.Excluded = map[string]string{"": "reason"} },
		"stale exclusion":           func(m *Manifest) { m.Excluded = map[string]string{"222": "old snapshot"} },
		"unsupported claimed owner": func(m *Manifest) { m.UIDs = append(m.UIDs, "222") },
		"missing Postgres target":   func(m *Manifest) { m.PostgresTarget = "" },
		"skip eligible owner":       func(m *Manifest) { m.UIDs = nil; m.Excluded = map[string]string{"111": "skip"} },
	} {
		t.Run(name, func(t *testing.T) {
			manifest := valid()
			mutate(&manifest)
			if reviewErr := Review(&inventory, &manifest); reviewErr == nil {
				t.Fatal("unreviewed or inconsistent ownership accepted")
			}
		})
	}
	r := Record("111", "operation")
	if validationErr := r.Validate(); validationErr != nil {
		t.Fatal(validationErr)
	}
}

func TestAuthInventoryDoesNotInferLegacyProofFromUIDShape(t *testing.T) {
	user := func(uid string) *firebaseauth.ExportedUserRecord {
		return &firebaseauth.ExportedUserRecord{UserRecord: &firebaseauth.UserRecord{UserInfo: &firebaseauth.UserInfo{UID: uid}, UserMetadata: &firebaseauth.UserMetadata{LastLogInTimestamp: 1}}}
	}
	users := map[string]*firebaseauth.ExportedUserRecord{"111": user("111"), "222": user("222"), "333": user("333"), "444": user("444"), "opaque-user": user("opaque-user"), "555": user("555")}
	users["222"].Disabled = true
	users["333"].UserMetadata.LastLogInTimestamp = 0
	users["444"].ProviderUserInfo = []*firebaseauth.UserInfo{{ProviderID: "google.com"}}
	allowed := map[string]bool{"111": true, "222": true, "333": true, "444": true, "opaque-user": true, "777": true}
	inventory := Inventory{Candidates: []string{}, Issues: []Issue{}}
	inventory.checkAuth(users, allowed)
	if !reflect.DeepEqual(inventory.Candidates, []string{"111"}) {
		t.Fatalf("unproved candidates: %v", inventory.Candidates)
	}
	issues := map[string]bool{}
	for _, issue := range inventory.Issues {
		issues[issue.UID] = issue.Blocking
	}
	for _, uid := range []string{"222", "333", "444", "opaque-user"} {
		if !issues[uid] {
			t.Fatalf("unproved admitted UID %s was not blocked", uid)
		}
	}
	for _, uid := range []string{"555", "777"} {
		if blocking, present := issues[uid]; !present || blocking {
			t.Fatalf("non-admitted/pending UID %s lacks an explicit review disposition", uid)
		}
	}
}

func TestInventoryRejectsInvalidDatabaseConfigBeforeClientAccess(t *testing.T) {
	if _, scanErr := Scan(context.Background(), nil, nil, "postgresql://%zz", "project", "database"); scanErr == nil {
		t.Fatal("invalid database configuration accepted")
	}
}
