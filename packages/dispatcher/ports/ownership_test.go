package ports_test

import (
	"context"
	"errors"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

func TestResolveOwnerRejectsUnusableRecords(t *testing.T) {
	ctx := context.Background()
	base, fixtureErr := (&portstest.MockConnectionResolver{}).Resolve(ctx, "123")
	if fixtureErr != nil {
		t.Fatal(fixtureErr)
	}
	base.UID, base.Provenance, base.BootstrapID = "independent-uid", "oauth", ""
	for _, tc := range []struct {
		name   string
		change func(*activityconnection.Record)
		err    error
	}{
		{"opaque UID", func(*activityconnection.Record) {}, nil},
		{"wrong subject", func(r *activityconnection.Record) { r.Subject = "456" }, nil},
		{"inactive", func(r *activityconnection.Record) { r.Status = "disconnected" }, nil},
		{"invalid UID", func(r *activityconnection.Record) { r.UID = "a/b" }, nil},
		{"absent", func(*activityconnection.Record) {}, activityconnection.ErrNotFound},
		{"backend", func(*activityconnection.Record) {}, context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			tc.change(&r)
			resolver := &portstest.MockConnectionResolver{ResolveFunc: func(_ context.Context, subject string) (activityconnection.Record, error) {
				if subject != "123" {
					t.Fatalf("subject=%q", subject)
				}
				return r, tc.err
			}}
			got, err := ports.ResolveOwner(ctx, resolver, 123)
			if tc.name == "opaque UID" {
				if err != nil || got != (ports.CredentialOwner{UID: base.UID, Subject: 123}) {
					t.Fatalf("owner=%+v, %v", got, err)
				}
			} else {
				want := tc.err
				if want == nil {
					want = activityconnection.ErrConflict
				}
				if !errors.Is(err, want) || got != (ports.CredentialOwner{}) {
					t.Fatalf("owner=%+v, err=%v; want %v", got, err, want)
				}
			}
		})
	}
	if _, err := ports.ResolveOwner(ctx, nil, 123); err == nil {
		t.Fatal("missing resolver accepted")
	}
}

func TestCredentialOwnerRejectsUnsafeKeys(t *testing.T) {
	for _, owner := range []ports.CredentialOwner{{UID: "", Subject: 1}, {UID: "../x", Subject: 1}, {UID: "uid", Subject: 0}, {UID: "uid", Subject: -1}} {
		if !errors.Is(owner.Validate(), activityconnection.ErrConflict) {
			t.Fatalf("accepted %+v", owner)
		}
	}
}
