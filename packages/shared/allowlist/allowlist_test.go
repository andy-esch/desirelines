package allowlist

import (
	"context"
	"errors"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

// newCheckerWithStub builds a FirestoreChecker that calls stub instead of
// hitting Firestore. Lets the IsAllowed branching logic be unit-tested
// without an emulator. The Firestore-emulator-backed integration test in
// allowlist_integration_test.go covers the real client wiring.
func newCheckerWithStub(stub docGetter) *FirestoreChecker {
	return &FirestoreChecker{getDoc: stub, logger: gcplog.NewNoOpLogger()}
}

func TestNewFirestoreChecker_ConstructorWiresGetter(t *testing.T) {
	// Smoke-test: the constructor must wrap the Firestore client in a
	// docGetter without invoking it. We pass a nil client — the closure
	// only dereferences `client` when IsAllowed is called, so construction
	// is safe. Without this test, NewFirestoreChecker is uncovered (its
	// real-client path is integration-only).
	checker := NewFirestoreChecker(nil, gcplog.NewNoOpLogger())
	if checker == nil {
		t.Fatal("NewFirestoreChecker returned nil")
	}
	if checker.getDoc == nil {
		t.Error("checker.getDoc is nil; constructor failed to wire the closure")
	}
	if checker.logger == nil {
		t.Error("checker.logger is nil")
	}
}

func TestFirestoreChecker_IsAllowed(t *testing.T) {
	cases := []struct {
		name      string
		stubErr   error
		wantOK    bool
		wantErr   bool
		wantWraps error // if non-nil, returned error must wrap this
	}{
		{
			name:    "doc exists returns allowed",
			stubErr: nil,
			wantOK:  true,
		},
		{
			name:    "NotFound returns not-allowed without error",
			stubErr: grpcstatus.Error(codes.NotFound, "no such document"),
			wantOK:  false,
		},
		{
			name:      "transient gRPC error is wrapped and surfaced",
			stubErr:   grpcstatus.Error(codes.Unavailable, "backend unreachable"),
			wantOK:    false,
			wantErr:   true,
			wantWraps: nil, // gRPC status errors don't unwrap to themselves; we only check Is-error here
		},
		{
			name:    "non-gRPC error (e.g., context error) is wrapped and surfaced",
			stubErr: context.DeadlineExceeded,
			wantOK:  false,
			wantErr: true,
			// Wrapping uses %w so context.DeadlineExceeded should still match via errors.Is.
			wantWraps: context.DeadlineExceeded,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seenAthlete string
			checker := newCheckerWithStub(func(_ context.Context, athleteID string) error {
				seenAthlete = athleteID
				return tc.stubErr
			})

			gotOK, gotErr := checker.IsAllowed(context.Background(), "12345")

			if seenAthlete != "12345" {
				t.Errorf("getDoc called with athleteID=%q, want %q", seenAthlete, "12345")
			}
			if gotOK != tc.wantOK {
				t.Errorf("IsAllowed allowed = %v, want %v", gotOK, tc.wantOK)
			}
			switch {
			case tc.wantErr && gotErr == nil:
				t.Errorf("IsAllowed err = nil, want non-nil")
			case !tc.wantErr && gotErr != nil:
				t.Errorf("IsAllowed err = %v, want nil", gotErr)
			}
			if tc.wantWraps != nil && !errors.Is(gotErr, tc.wantWraps) {
				t.Errorf("IsAllowed err = %v, want errors.Is to wrap %v", gotErr, tc.wantWraps)
			}
		})
	}
}
