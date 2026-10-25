// Package activityconnection owns the server-only Strava account registry.
package activityconnection

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Firestore paths and initial Strava connection values.
const (
	LookupsCollection     = "provider_accounts"
	ConnectionsCollection = "connections"
	MigrationCollection   = "identity_migration"
	MigrationDocument     = "legacy_admissions"
	Provider              = "strava"
	Active                = "active"
	LegacyUID             = "legacy_uid"
)

// Registry errors are stable sentinels for fail-closed callers.
var (
	ErrConflict        = errors.New("activity connection ownership conflict")
	ErrNotFound        = errors.New("active activity connection not found")
	ErrAdmissionDenied = errors.New("legacy admission denied")
)

// Record is stored identically at provider_accounts/strava:{subject} and
// users/{uid}/connections/strava. It contains no credentials or profile data.
type Record struct {
	SchemaVersion int64    `firestore:"schema_version" json:"schema_version"`
	UID           string   `firestore:"uid" json:"uid"`
	Provider      string   `firestore:"provider" json:"provider"`
	Subject       string   `firestore:"subject" json:"subject"`
	Scopes        []string `firestore:"scopes" json:"scopes"`
	Status        string   `firestore:"status" json:"status"`
	Provenance    string   `firestore:"provenance" json:"provenance"`
	BootstrapID   string   `firestore:"bootstrap_id" json:"bootstrap_id"`
}

// ValidateUID accepts an opaque Firebase UID usable as one Firestore key.
func ValidateUID(uid string) error {
	if uid == "" || !utf8.ValidString(uid) || utf8.RuneCountInString(uid) > 128 || uid == "." || uid == ".." || strings.Contains(uid, "/") || strings.ContainsFunc(uid, unicode.IsControl) {
		return errors.New("invalid Firebase UID document key")
	}
	return nil
}

// LookupKey validates the only currently supported provider subject.
func LookupKey(subject string) (string, error) {
	id, err := strconv.ParseInt(subject, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != subject {
		return "", errors.New("strava subject must be a canonical positive int64")
	}
	return Provider + ":" + subject, nil
}

// Validate checks the complete cross-language wire contract.
func (r *Record) Validate() error {
	if err := ValidateUID(r.UID); err != nil {
		return err
	}
	if _, err := LookupKey(r.Subject); err != nil {
		return err
	}
	if r.SchemaVersion != 1 || r.Provider != Provider || (r.Status != Active && r.Status != "disconnected") || r.Scopes == nil {
		return errors.New("invalid activity connection schema/provider/status/scopes")
	}
	if provenanceErr := r.validateProvenance(); provenanceErr != nil {
		return provenanceErr
	}
	return validateScopes(r.Scopes)
}

func validateScopes(scopes []string) error {
	seen := map[string]bool{}
	for _, scope := range scopes {
		if strings.TrimSpace(scope) != scope || scope == "" || seen[scope] {
			return fmt.Errorf("invalid or duplicate scope %q", scope)
		}
		seen[scope] = true
	}
	return nil
}

func (r *Record) validateProvenance() error {
	if r.Provenance != LegacyUID && r.Provenance != "oauth" && r.Provenance != "dev_fixture" {
		return errors.New("invalid connection provenance")
	}
	if r.Provenance == LegacyUID && (r.UID != r.Subject || r.BootstrapID == "") {
		return errors.New("legacy connection requires original UID and bootstrap ID")
	}
	if len(r.BootstrapID) > 128 || strings.ContainsAny(r.BootstrapID, "/\r\n") {
		return errors.New("invalid bootstrap ID")
	}
	return nil
}
