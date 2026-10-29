// Package connectionbootstrap inventories legacy identities without trusting
// client-writable provider fields. An operator must review every UID explicitly.
package connectionbootstrap

import (
	"errors"
	"fmt"
	"regexp"
	"slices"

	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Issue records an unresolved identity boundary; blocking issues cannot be excluded.
type Issue struct {
	UID      string `json:"uid"`
	Reason   string `json:"reason"`
	Blocking bool   `json:"blocking"`
}

// Inventory is a credential-free snapshot requiring operator review.
type Inventory struct {
	Project        string   `json:"project"`
	Database       string   `json:"database"`
	PostgresTarget string   `json:"postgres_target"`
	Candidates     []string `json:"candidates"`
	Issues         []Issue  `json:"issues"`
	// Document presence is reviewed separately from server-issued UID ownership.
	MissingLegacyDocuments map[string][]string `json:"missing_legacy_documents,omitempty"`
}

// Manifest attests to legacy UID provenance and dispositions a specific target.
type Manifest struct {
	Project        string `json:"project"`
	Database       string `json:"database"`
	PostgresTarget string `json:"postgres_target"`
	OperationID    string `json:"operation_id"`
	// This is an operator attestation of the legacy server-issued UID provenance,
	// not a capability inferred from UID shape or profile data.
	ReviewedLegacyUIDs bool              `json:"reviewed_legacy_uids"`
	UIDs               []string          `json:"uids"`
	Excluded           map[string]string `json:"excluded"`
	// Exact acknowledgement of inventory's absent document paths, not a grant.
	MissingLegacyDocuments map[string][]string `json:"missing_legacy_documents,omitempty"`
}

var operationID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

// Validate rejects ambiguous operation IDs, targets and owner dispositions.
func (m *Manifest) Validate(project, database string) error {
	if m.Project != project || m.Database != database || m.PostgresTarget == "" || !m.ReviewedLegacyUIDs || !operationID.MatchString(m.OperationID) {
		return errors.New("manifest target, operation or provenance attestation invalid")
	}
	seen := map[string]bool{}
	for _, uid := range m.UIDs {
		if _, err := activityconnection.LookupKey(uid); err != nil {
			return fmt.Errorf("validate legacy UID: %w", err)
		}
		if seen[uid] || m.Excluded[uid] != "" {
			return errors.New("duplicate or excluded manifest UID")
		}
		seen[uid] = true
	}
	for uid, reason := range m.Excluded {
		if uid == "" || reason == "" || seen[uid] {
			return errors.New("invalid exclusion")
		}
	}
	return m.validateMissingLegacyDocuments(seen)
}

func (m *Manifest) validateMissingLegacyDocuments(claimed map[string]bool) error {
	for uid, documents := range m.MissingLegacyDocuments {
		if !claimed[uid] || len(documents) == 0 {
			return errors.New("missing-document acknowledgement requires a claimed UID and document names")
		}
		seenDocuments := map[string]bool{}
		for _, name := range documents {
			if (name != stravatoken.ProfileDocument && name != stravatoken.TokensDocument) || seenDocuments[name] {
				return errors.New("unknown or duplicate legacy document name")
			}
			seenDocuments[name] = true
		}
	}
	return nil
}

// Review refuses newly appeared owners, unresolved issues and unsupported UIDs.
// Exclusions are explicit owner dispositions, never silent orphan skipping.
func Review(inventory *Inventory, m *Manifest) error {
	if inventory.PostgresTarget != m.PostgresTarget {
		return errors.New("manifest Postgres target differs from inventory")
	}
	if err := m.Validate(inventory.Project, inventory.Database); err != nil {
		return fmt.Errorf("validate legacy UID: %w", err)
	}
	known := map[string]bool{}
	for _, uid := range inventory.Candidates {
		known[uid] = true
		if !slices.Contains(m.UIDs, uid) {
			return fmt.Errorf("unreviewed candidate %s", uid)
		}
		observed := slices.Clone(inventory.MissingLegacyDocuments[uid])
		reviewed := slices.Clone(m.MissingLegacyDocuments[uid])
		slices.Sort(observed)
		slices.Sort(reviewed)
		if !slices.Equal(observed, reviewed) {
			return fmt.Errorf("missing legacy documents for %s differ from reviewed manifest; refresh inventory and review", uid)
		}
	}
	for _, issue := range inventory.Issues {
		known[issue.UID] = true
		if issue.Blocking || m.Excluded[issue.UID] == "" {
			return fmt.Errorf("unresolved %s: %s", issue.UID, issue.Reason)
		}
	}
	for _, uid := range m.UIDs {
		if !slices.Contains(inventory.Candidates, uid) {
			return fmt.Errorf("UID %s is not an eligible candidate", uid)
		}
	}
	for uid := range m.Excluded {
		if !known[uid] {
			return fmt.Errorf("stale exclusion %s", uid)
		}
	}
	return nil
}

// Record constructs an operation-owned legacy mapping without credential data.
func Record(uid, operation string) activityconnection.Record {
	return activityconnection.Record{SchemaVersion: 1, UID: uid, Provider: activityconnection.Provider, Subject: uid, Scopes: []string{}, Status: activityconnection.Active, Provenance: activityconnection.LegacyUID, BootstrapID: operation}
}
