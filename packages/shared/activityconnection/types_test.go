package activityconnection

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func contractFixture(t *testing.T, name string) []byte {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "..", "schemas", "test-fixtures", name)) //nolint:gosec // Fixture names are constants in this test file.
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRecordContract(t *testing.T) {
	data := contractFixture(t, "activity_connection.json")
	var r Record
	if err := json.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
	if r.UID == r.Subject || r.Scopes[0] != "activity:read_all" {
		t.Fatal("fixture must exercise independent ownership and non-default scopes")
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	typ := reflect.TypeOf(r)
	if len(fields) != typ.NumField() {
		t.Fatal("fixture/schema field drift")
	}
	for i := 0; i < typ.NumField(); i++ {
		if _, ok := fields[typ.Field(i).Tag.Get("firestore")]; !ok {
			t.Fatalf("missing field %s", typ.Field(i).Name)
		}
	}
	for _, subject := range []string{"", "0", "-1", "+1", "001", "1/2", "9223372036854775808"} {
		if _, keyErr := LookupKey(subject); keyErr == nil {
			t.Errorf("accepted invalid subject %q", subject)
		}
	}
	for _, uid := range []string{"", "../user", ".", "..", strings.Repeat("x", 129), "a\nb"} {
		r.UID = uid
		if validationErr := r.Validate(); validationErr == nil {
			t.Errorf("accepted invalid UID %q", uid)
		}
	}
}

func TestRecordValidationBoundaries(t *testing.T) {
	valid := func() Record {
		return Record{SchemaVersion: 1, UID: "opaque-user", Provider: Provider, Subject: "111", Scopes: []string{"read"}, Status: Active, Provenance: "oauth"}
	}
	cases := map[string]func(*Record){
		"invalid subject":             func(r *Record) { r.Subject = "001" },
		"unsupported schema":          func(r *Record) { r.SchemaVersion = 2 },
		"wrong provider":              func(r *Record) { r.Provider = "other" },
		"unknown status":              func(r *Record) { r.Status = "pending" },
		"absent scopes":               func(r *Record) { r.Scopes = nil },
		"unknown provenance":          func(r *Record) { r.Provenance = "guessed" },
		"legacy UID mismatch":         func(r *Record) { r.Provenance = LegacyUID; r.BootstrapID = "operation" },
		"missing legacy operation":    func(r *Record) { r.Provenance = LegacyUID; r.UID = r.Subject },
		"oversized Unicode operation": func(r *Record) { r.BootstrapID = strings.Repeat("é", 65) },
		"oversized operation":         func(r *Record) { r.BootstrapID = strings.Repeat("x", 129) },
		"path-shaped operation":       func(r *Record) { r.BootstrapID = "../operation" },
		"empty scope":                 func(r *Record) { r.Scopes = []string{""} },
		"scope whitespace":            func(r *Record) { r.Scopes = []string{" read"} },
		"duplicate scopes":            func(r *Record) { r.Scopes = []string{"read", "read"} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := valid()
			mutate(&r)
			if validationErr := r.Validate(); validationErr == nil {
				t.Fatal("invalid wire record accepted")
			}
		})
	}
	for _, uid := range []string{"opaque-user", strings.Repeat("界", 128)} {
		if validationErr := ValidateUID(uid); validationErr != nil {
			t.Fatal(validationErr)
		}
	}
	if validationErr := ValidateUID("\xff"); validationErr == nil {
		t.Fatal("invalid UTF-8 UID accepted")
	}
	if _, keyErr := LookupKey("9223372036854775807"); keyErr != nil {
		t.Fatal(keyErr)
	}
	r := valid()
	r.Provenance = "dev_fixture"
	r.Status = "disconnected"
	r.Scopes = []string{}
	if validationErr := r.Validate(); validationErr != nil {
		t.Fatal(validationErr)
	}
}

func TestInvalidClaimFailsBeforeClientAccess(t *testing.T) {
	s := Store{}
	ctx := context.Background()
	if _, claimErr := s.Claim(ctx, nil); !errors.Is(claimErr, ErrConflict) {
		t.Fatalf("nil claim: %v", claimErr)
	}
	if _, rollbackErr := s.Rollback(ctx, nil); !errors.Is(rollbackErr, ErrConflict) {
		t.Fatalf("nil rollback: %v", rollbackErr)
	}
	r := Record{SchemaVersion: 1, UID: "opaque", Provider: Provider, Subject: "111", Scopes: []string{}, Status: "disconnected", Provenance: "oauth"}
	if _, claimErr := s.Claim(ctx, &r); !errors.Is(claimErr, ErrNotFound) {
		t.Fatalf("inactive claim: %v", claimErr)
	}
	if _, rollbackErr := s.Rollback(ctx, &r); !errors.Is(rollbackErr, ErrConflict) {
		t.Fatalf("non-legacy rollback: %v", rollbackErr)
	}
	r.Subject = "001"
	if _, claimErr := s.Claim(ctx, &r); claimErr == nil {
		t.Fatal("invalid claim reached client")
	}
	if _, rollbackErr := s.Rollback(ctx, &r); rollbackErr == nil {
		t.Fatal("invalid rollback reached client")
	}
	if _, resolveErr := s.Resolve(ctx, r.Subject); resolveErr == nil {
		t.Fatal("invalid lookup reached client")
	}
	if _, resolveErr := s.ResolveInTransaction(nil, r.Subject); resolveErr == nil {
		t.Fatal("invalid transactional lookup reached client")
	}
}

func TestScopeContract(t *testing.T) {
	var cases []struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
		Valid  bool     `json:"valid"`
	}
	if err := json.Unmarshal(contractFixture(t, "activity_connection_scopes.json"), &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var record Record
			if err := json.Unmarshal(contractFixture(t, "activity_connection.json"), &record); err != nil {
				t.Fatal(err)
			}
			record.Scopes = tc.Scopes
			if err := record.Validate(); (err == nil) != tc.Valid {
				t.Fatalf("scopes %q valid=%v: %v", tc.Scopes, tc.Valid, err)
			}
		})
	}
}
