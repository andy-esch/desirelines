package connectionbootstrap

import "testing"

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
