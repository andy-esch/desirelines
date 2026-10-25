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
