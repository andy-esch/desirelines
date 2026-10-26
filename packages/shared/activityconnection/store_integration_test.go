//go:build integration

package activityconnection

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
)

func testStore(t *testing.T) Store {
	t.Helper()
	t.Setenv("FIRESTORE_DATABASE", fmt.Sprintf("registry-%d", time.Now().UnixNano()))
	return Store{Client: firestoretest.NewClient(t)}
}
func record(uid, subject string) Record {
	return Record{1, uid, Provider, subject, []string{"activity:read_all"}, Active, "oauth", ""}
}
func legacyRecord(uid, op string) Record {
	return Record{1, uid, Provider, uid, []string{}, Active, LegacyUID, op}
}
func freeze(t *testing.T, s Store) {
	t.Helper()
	if _, err := s.Client.Collection(MigrationCollection).Doc(MigrationDocument).Set(context.Background(), Migration{true, true}); err != nil {
		t.Fatal(err)
	}
}

func TestClaimOwnershipAndRetry(t *testing.T) {
	for _, sameSubject := range []bool{true, false} {
		t.Run(fmt.Sprintf("sameSubject=%v", sameSubject), func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			a, b := record("opaque-A", "111"), record("opaque-B", "111")
			if !sameSubject {
				b = record("opaque-A", "222")
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for _, r := range []Record{a, b} {
				wg.Go(func() { <-start; _, err := s.Claim(ctx, &r); results <- err })
			}
			close(start)
			wg.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
				} else if !errors.Is(err, ErrConflict) {
					t.Fatal(err)
				}
			}
			if successes != 1 {
				t.Fatalf("%d claims won, want exactly one", successes)
			}
			var winner Record
			for _, candidate := range []Record{a, b} {
				resolved, err := s.Resolve(ctx, candidate.Subject)
				if err == nil && resolved.UID == candidate.UID {
					winner = resolved
					break
				}
			}
			if winner.UID == "" {
				t.Fatal("winner is not resolvable")
			}
			created, err := s.Claim(ctx, &winner)
			if err != nil || created {
				t.Fatalf("repeat claim=%v,%v", created, err)
			}
			winner.Status = "disconnected"
			lookup, connection := s.refs(winner.UID, winner.Subject)
			if _, err = lookup.Set(ctx, winner); err != nil {
				t.Fatal(err)
			}
			if _, err = connection.Set(ctx, winner); err != nil {
				t.Fatal(err)
			}
			if _, err = s.Resolve(ctx, winner.Subject); !errors.Is(err, ErrNotFound) {
				t.Fatalf("inactive lookup: %v", err)
			}
		})
	}
}

func TestBootstrapGuardsAndRollback(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	r := legacyRecord("123", "operation-1")
	if _, err := s.Claim(ctx, &r); err == nil {
		t.Fatal("bootstrap without freeze accepted")
	}
	freeze(t, s)
	if _, err := s.Claim(ctx, &r); err == nil {
		t.Fatal("bootstrap without admission accepted")
	}
	if _, err := s.Client.Collection("allowlist").Doc(r.UID).Set(ctx, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if made, err := s.Claim(ctx, &r); err != nil || !made {
		t.Fatalf("bootstrap=%v,%v", made, err)
	}
	other := r
	other.BootstrapID = "operation-2"
	if made, err := s.Claim(ctx, &other); err != nil || made {
		t.Fatalf("repeat=%v,%v", made, err)
	}
	if err := s.Rollback(ctx, &other); !errors.Is(err, ErrConflict) {
		t.Fatalf("wrong-operation rollback=%v", err)
	}
	got, err := s.Resolve(ctx, r.Subject)
	if err != nil || !reflect.DeepEqual(got, r) {
		t.Fatalf("unexpected mutation: %+v,%v", got, err)
	}
	if err = s.Rollback(ctx, &r); err != nil {
		t.Fatal(err)
	}
	if err = s.Rollback(ctx, &r); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Resolve(ctx, r.Subject); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rolled-back owner: %v", err)
	}
}

func TestWireTypesAreNotSilentlyCoerced(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	r := record("opaque-A", "111")
	if _, err := s.Claim(ctx, &r); err != nil {
		t.Fatal(err)
	}
	lookup, _ := s.refs(r.UID, r.Subject)
	for name, updates := range map[string][]firestore.Update{
		"null optional string":                    {{Path: "bootstrap_id", Value: nil}},
		"floating schema version":                 {{Path: "schema_version", Value: float64(1)}},
		"unknown field replacing optional string": {{Path: "bootstrap_id", Value: firestore.Delete}, {Path: "future_field", Value: "changed"}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := lookup.Set(ctx, r); err != nil {
				t.Fatal(err)
			}
			if _, err := lookup.Update(ctx, updates); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Resolve(ctx, r.Subject); !errors.Is(err, ErrConflict) {
				t.Fatalf("malformed document resolved: %v", err)
			}
		})
	}
}

func TestMigrationControlsFenceWritesAndRollback(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	r := legacyRecord("123", "operation")
	if sealErr := s.Seal(ctx); sealErr == nil {
		t.Fatal("seal without freeze accepted")
	}
	if freezeErr := s.Freeze(ctx); freezeErr != nil {
		t.Fatal(freezeErr)
	}
	if freezeErr := s.Freeze(ctx); freezeErr != nil {
		t.Fatalf("freeze is not idempotent: %v", freezeErr)
	}
	if _, writeErr := s.Client.Collection("allowlist").Doc(r.UID).Set(ctx, map[string]any{}); writeErr != nil {
		t.Fatal(writeErr)
	}
	check := func(subject string) error {
		return s.Client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error { return s.CheckLegacyAdmission(tx, subject) })
	}
	if admissionErr := check(r.Subject); !errors.Is(admissionErr, ErrAdmissionDenied) {
		t.Fatalf("unmapped admission: %v", admissionErr)
	}
	if _, claimErr := s.Claim(ctx, &r); claimErr != nil {
		t.Fatal(claimErr)
	}
	if admissionErr := check(r.Subject); admissionErr != nil {
		t.Fatal(admissionErr)
	}
	if sealErr := s.Seal(ctx); sealErr != nil {
		t.Fatal(sealErr)
	}
	if admissionErr := check(r.Subject); admissionErr != nil {
		t.Fatalf("sealing stranded existing user: %v", admissionErr)
	}
	if _, claimErr := s.Claim(ctx, &r); claimErr == nil {
		t.Fatal("sealed bootstrap accepted a write")
	}
	if rollbackErr := s.Rollback(ctx, &r); rollbackErr == nil {
		t.Fatal("sealed rollback accepted")
	}
	if freezeErr := s.Freeze(ctx); freezeErr == nil {
		t.Fatal("sealed rollback reopened")
	}
	got, resolveErr := s.Resolve(ctx, r.Subject)
	if resolveErr != nil || !reflect.DeepEqual(got, r) {
		t.Fatalf("sealed data changed: %+v %v", got, resolveErr)
	}
}

func TestAdmissionAndMalformedStateFailClosed(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	check := func(subject string) error {
		return s.Client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error { return s.CheckLegacyAdmission(tx, subject) })
	}
	if admissionErr := check("001"); admissionErr == nil {
		t.Fatal("noncanonical subject accepted")
	}
	if admissionErr := check("123"); !errors.Is(admissionErr, ErrAdmissionDenied) {
		t.Fatalf("missing admission: %v", admissionErr)
	}
	if _, writeErr := s.Client.Collection("allowlist").Doc("123").Set(ctx, map[string]any{}); writeErr != nil {
		t.Fatal(writeErr)
	}
	if admissionErr := check("123"); admissionErr != nil {
		t.Fatalf("legacy admission without migration control: %v", admissionErr)
	}
	control := s.Client.Collection(MigrationCollection).Doc(MigrationDocument)
	for name, data := range map[string]map[string]any{
		"missing frozen":   {"rollback_allowed": true},
		"missing rollback": {"frozen": true},
		"string boolean":   {"frozen": "true", "rollback_allowed": true},
		"null boolean":     {"frozen": true, "rollback_allowed": nil},
	} {
		t.Run(name, func(t *testing.T) {
			if _, writeErr := control.Set(ctx, data); writeErr != nil {
				t.Fatal(writeErr)
			}
			if admissionErr := check("123"); admissionErr == nil {
				t.Fatal("malformed control allowed login")
			}
			if freezeErr := s.Freeze(ctx); freezeErr == nil {
				t.Fatal("freeze silently replaced malformed control")
			}
		})
	}
}

func TestRollbackPreservesChangedOrIncompletePairs(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	r := legacyRecord("123", "operation")
	if freezeErr := s.Freeze(ctx); freezeErr != nil {
		t.Fatal(freezeErr)
	}
	if _, writeErr := s.Client.Collection("allowlist").Doc(r.UID).Set(ctx, map[string]any{}); writeErr != nil {
		t.Fatal(writeErr)
	}
	if _, claimErr := s.Claim(ctx, &r); claimErr != nil {
		t.Fatal(claimErr)
	}
	lookup, connection := s.refs(r.UID, r.Subject)
	changed := r
	changed.Scopes = []string{"activity:read_all"}
	for _, ref := range []*firestore.DocumentRef{lookup, connection} {
		if _, writeErr := ref.Set(ctx, changed); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if rollbackErr := s.Rollback(ctx, &r); !errors.Is(rollbackErr, ErrConflict) {
		t.Fatalf("changed records erased: %v", rollbackErr)
	}
	got, resolveErr := s.Resolve(ctx, r.Subject)
	if resolveErr != nil || !reflect.DeepEqual(got, changed) {
		t.Fatal("rollback changed the current grant")
	}
	if _, deleteErr := connection.Delete(ctx); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if _, resolveErr = s.Resolve(ctx, r.Subject); !errors.Is(resolveErr, ErrConflict) {
		t.Fatalf("half mapping resolved: %v", resolveErr)
	}
	if rollbackErr := s.Rollback(ctx, &r); !errors.Is(rollbackErr, ErrConflict) {
		t.Fatalf("half mapping rollback: %v", rollbackErr)
	}
	if _, readErr := lookup.Get(ctx); readErr != nil {
		t.Fatal("rollback erased the surviving record")
	}
	if _, claimErr := s.Claim(ctx, &r); !errors.Is(claimErr, ErrConflict) {
		t.Fatalf("claim silently healed a half mapping: %v", claimErr)
	}
}
