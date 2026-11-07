//go:build integration

package firestore

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/firestore/apiv1/firestorepb"
	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/cache"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func ownerRecord(owner ports.CredentialOwner) activityconnection.Record {
	return activityconnection.Record{SchemaVersion: 1, UID: owner.UID, Subject: strconv.FormatInt(owner.Subject, 10), Provider: activityconnection.Provider, Scopes: []string{}, Status: activityconnection.Active, Provenance: "oauth"}
}

func seedOwner(t *testing.T, store *TokenStore, owner ports.CredentialOwner) {
	t.Helper()
	r := ownerRecord(owner)
	if err := writeFixture(context.Background(), store.client, map[string]any{
		"provider_accounts/strava:" + r.Subject: r, "users/" + r.UID + "/connections/strava": r,
	}, nil); err != nil {
		t.Fatal(err)
	}
}

func writeFixture(ctx context.Context, client *firestore.Client, sets map[string]any, deletes []string) error {
	if err := client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		for path, value := range sets {
			if err := tx.Set(client.Doc(path), value); err != nil {
				return fmt.Errorf("set fixture: %w", err)
			}
		}
		for _, path := range deletes {
			if err := tx.Delete(client.Doc(path)); err != nil {
				return fmt.Errorf("delete fixture: %w", err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("fixture transaction: %w", err)
	}
	return nil
}

func tokenFixture() *stravatoken.Data {
	return &stravatoken.Data{AccessToken: "old-access", RefreshToken: "old-refresh", ExpiresAt: 2000000000, LastRefreshed: time.Unix(123, 0).UTC()}
}

func TestCredentialsUseUIDAndPreserveOtherNamespaces(t *testing.T) {
	for _, uid := range []string{"opaque-app-owner", "987654", "321"} {
		t.Run(uid, func(t *testing.T) {
			store := newTestStore(t)
			owner := ports.CredentialOwner{UID: uid, Subject: 321}
			seedOwner(t, store, owner)
			data := tokenFixture()
			if _, err := store.tokensRef(owner).Set(context.Background(), data); err != nil {
				t.Fatal(err)
			}
			decoy := ports.CredentialOwner{UID: "another-owner", Subject: 321}
			if uid != "321" {
				decoy.UID = "321"
			}
			if _, err := store.tokensRef(decoy).Set(context.Background(), tokenFixture()); err != nil {
				t.Fatal(err)
			}
			got, err := store.GetTokens(context.Background(), owner)
			if err != nil || got.AccessToken != data.AccessToken {
				t.Fatalf("read=%v %v", got, err)
			}
			next := *data
			next.AccessToken = "new-access"
			if _, writeErr := store.WriteTokensIfUnmodified(context.Background(), owner, &next, data.LastRefreshed); writeErr != nil {
				t.Fatal(writeErr)
			}
			if deleteErr := store.DeleteTokens(context.Background(), owner); deleteErr != nil {
				t.Fatal(deleteErr)
			}
			if _, readErr := store.GetTokens(context.Background(), owner); !errors.Is(readErr, ports.ErrTokenNotFound) {
				t.Fatalf("deleted read=%v", readErr)
			}
			other, err := store.tokensRef(decoy).Get(context.Background())
			if err != nil || other.Data()["access_token"] != "old-access" {
				t.Fatalf("unrelated namespace changed: %v %v", other, err)
			}
		})
	}
}

func TestCredentialsRejectChangedOwnershipWithoutOrphanClassification(t *testing.T) {
	for _, change := range []string{"missing", "incomplete", "inactive", "reassigned"} {
		t.Run(change, func(t *testing.T) {
			store := newTestStore(t)
			ctx := context.Background()
			owner := ports.CredentialOwner{UID: "original-owner", Subject: 654}
			seedOwner(t, store, owner)
			original := tokenFixture()
			if _, err := store.tokensRef(owner).Set(ctx, original); err != nil {
				t.Fatal(err)
			}
			r := ownerRecord(owner)
			sets := map[string]any{}
			var deletes []string
			switch change {
			case "missing":
				deletes = []string{"provider_accounts/strava:" + r.Subject}
			case "incomplete":
				deletes = []string{"users/" + r.UID + "/connections/strava"}
			case "inactive":
				r.Status = "disconnected"
				sets["provider_accounts/strava:"+r.Subject] = r
				sets["users/"+r.UID+"/connections/strava"] = r
			case "reassigned":
				r.UID = "654"
				sets["provider_accounts/strava:"+r.Subject] = r
				sets["users/"+r.UID+"/connections/strava"] = r
			}
			if err := writeFixture(ctx, store.client, sets, deletes); err != nil {
				t.Fatal(err)
			}
			want := activityconnection.ErrConflict
			if change == "missing" || change == "inactive" {
				want = activityconnection.ErrNotFound
			}
			_, readErr := store.GetTokens(ctx, owner)
			_, writeErr := store.WriteTokensIfUnmodified(ctx, owner, tokenFixture(), original.LastRefreshed)
			deleteErr := store.DeleteTokens(ctx, owner)
			for _, err := range []error{store.ValidateOwner(ctx, owner), readErr, writeErr, deleteErr} {
				if !errors.Is(err, want) || errors.Is(err, ports.ErrTokenNotFound) {
					t.Fatalf("ownership failure=%v want=%v", err, want)
				}
			}
			got, err := store.tokensRef(owner).Get(ctx)
			if err != nil || got.Data()["access_token"] != original.AccessToken {
				t.Fatal("rejected operation mutated original credentials")
			}
		})
	}
}

// Force a real SDK retry by rolling back the first snapshot before changing
// fixtures and returning Aborted. This exercises callback revalidation, not
// emulator contention scheduling or a stronger cross-system atomicity claim.
func retryStore(t *testing.T, change func(context.Context) error) (*TokenStore, *atomic.Int32) {
	t.Helper()
	host := strings.TrimSpace(os.Getenv("FIRESTORE_EMULATOR_HOST"))
	if host == "" {
		t.Fatal("Firestore emulator required")
	}
	var begins, commits atomic.Int32
	unary := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoke grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer owner") // Emulator-only owner credential.
		if strings.HasSuffix(method, "/BeginTransaction") {
			begins.Add(1)
		}
		if strings.HasSuffix(method, "/Commit") && commits.Add(1) == 1 {
			commit, ok := req.(*firestorepb.CommitRequest)
			if !ok {
				return status.Error(codes.Internal, "unexpected commit request")
			}
			if _, err := firestorepb.NewFirestoreClient(cc).Rollback(ctx, &firestorepb.RollbackRequest{Database: commit.Database, Transaction: commit.Transaction}); err != nil {
				return fmt.Errorf("rollback test snapshot: %w", err)
			}
			if err := change(ctx); err != nil {
				return err
			}
			return status.Error(codes.Aborted, "exercise SDK ownership retry")
		}
		return invoke(ctx, method, req, reply, cc, opts...)
	}
	stream := func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		return streamer(metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer owner"), desc, cc, method, opts...)
	}
	conn, err := grpc.NewClient(host, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithUnaryInterceptor(unary), grpc.WithStreamInterceptor(stream))
	if err != nil {
		t.Fatal(err)
	}
	client, err := firestore.NewClientWithDatabase(context.Background(), cmp.Or(os.Getenv("GCP_PROJECT_ID"), "test-project"), cmp.Or(os.Getenv("FIRESTORE_DATABASE"), "test-db"), option.WithoutAuthentication(), option.WithGRPCConn(conn))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	noop := otel.NoopProviders()
	hist, _ := noop.Meter.Float64Histogram("test") //nolint:errcheck // no-op instrument
	return NewTokenStore(client, hist, noop.Tracer), &begins
}

func TestCredentialMutationRetryKeepsOriginalOwner(t *testing.T) {
	for _, operation := range []string{"refresh", "delete"} {
		for _, change := range []string{"unchanged", "reassigned", "disconnected", "deleted"} {
			t.Run(operation+"/"+change, func(t *testing.T) {
				base := newTestStore(t)
				ctx := context.Background()
				owner := ports.CredentialOwner{UID: "retry-original", Subject: 765}
				seedOwner(t, base, owner)
				before := tokenFixture()
				if _, err := base.tokensRef(owner).Set(ctx, before); err != nil {
					t.Fatal(err)
				}
				target := ports.CredentialOwner{UID: "765", Subject: 765}
				if _, err := base.tokensRef(target).Set(ctx, tokenFixture()); err != nil {
					t.Fatal(err)
				}
				store, begins := retryStore(t, func(ctx context.Context) error {
					return changeRetryOwnership(ctx, base, owner, target, change)
				})
				var err error
				if operation == "refresh" {
					next := *before
					next.AccessToken = "refreshed"
					_, err = store.WriteTokensIfUnmodified(ctx, owner, &next, before.LastRefreshed)
				} else {
					err = store.DeleteTokens(ctx, owner)
				}
				if begins.Load() != 2 {
					t.Fatalf("SDK attempts=%d want 2", begins.Load())
				}
				assertRetryOutcome(t, base, owner, target, operation, change, err)
			})
		}
	}
}

func TestCredentialReadRetryDoesNotRetainAbsentFields(t *testing.T) {
	base := newTestStore(t)
	owner := ports.CredentialOwner{UID: "read-retry-owner", Subject: 876}
	seedOwner(t, base, owner)
	if _, err := base.tokensRef(owner).Set(context.Background(), tokenFixture()); err != nil {
		t.Fatal(err)
	}
	store, begins := retryStore(t, func(ctx context.Context) error {
		_, err := base.tokensRef(owner).Set(ctx, map[string]any{"access_token": "new-access", "expires_at": int64(2000000000)})
		if err != nil {
			return fmt.Errorf("replace test credentials: %w", err)
		}
		return nil
	})
	got, err := store.GetTokens(context.Background(), owner)
	if begins.Load() != 2 || got != nil || !errors.Is(err, stravatoken.ErrIncompleteTokens) {
		t.Fatalf("retry retained old fields: attempts=%d tokens=%v err=%v", begins.Load(), got, err)
	}
}

func TestCachedCredentialsObserveLiveRegistryRevocation(t *testing.T) {
	base := newTestStore(t)
	owner := ports.CredentialOwner{UID: "cached-live-owner", Subject: 987}
	seedOwner(t, base, owner)
	if _, err := base.tokensRef(owner).Set(context.Background(), tokenFixture()); err != nil {
		t.Fatal(err)
	}
	cached := cache.NewTokenStore(base, time.Hour, 10)
	for range 2 { // A miss followed by a live, valid ownership check on a hit.
		if _, err := cached.GetTokens(context.Background(), owner); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeFixture(context.Background(), base.client, nil, []string{"provider_accounts/strava:987"}); err != nil {
		t.Fatal(err)
	}
	got, err := cached.GetTokens(context.Background(), owner)
	if got != nil || !errors.Is(err, activityconnection.ErrNotFound) || errors.Is(err, ports.ErrTokenNotFound) {
		t.Fatalf("cached credentials escaped revoked registry: %v %v", got, err)
	}
}

func changeRetryOwnership(ctx context.Context, base *TokenStore, owner, target ports.CredentialOwner, change string) error {
	r := ownerRecord(owner)
	sets := map[string]any{}
	var deletes []string
	switch change {
	case "reassigned":
		r.UID = target.UID
		sets["provider_accounts/strava:"+r.Subject] = r
		sets["users/"+target.UID+"/connections/strava"] = r
		deletes = []string{"users/" + owner.UID + "/connections/strava"}
	case "disconnected":
		r.Status = "disconnected"
		sets["provider_accounts/strava:"+r.Subject] = r
		sets["users/"+r.UID+"/connections/strava"] = r
	case "deleted":
		deletes = []string{"provider_accounts/strava:" + r.Subject, "users/" + r.UID + "/connections/strava", "users/" + r.UID + "/private/strava_tokens"}
	}
	return writeFixture(ctx, base.client, sets, deletes)
}

func assertRetryOutcome(t *testing.T, base *TokenStore, owner, target ports.CredentialOwner, operation, change string, err error) {
	t.Helper()
	ctx := context.Background()
	wantErr := map[string]error{"unchanged": nil, "reassigned": activityconnection.ErrConflict, "disconnected": activityconnection.ErrNotFound, "deleted": activityconnection.ErrNotFound}[change]
	if !errors.Is(err, wantErr) {
		t.Fatalf("error=%v want=%v", err, wantErr)
	}
	if err != nil && errors.Is(err, ports.ErrTokenNotFound) {
		t.Fatalf("registry failure became token orphan: %v", err)
	}
	snap, getErr := base.tokensRef(target).Get(ctx)
	if getErr != nil || snap.Data()["access_token"] != "old-access" {
		t.Fatal("mutation reached replacement owner")
	}
	snap, getErr = base.tokensRef(owner).Get(ctx)
	if change == "deleted" || (change == "unchanged" && operation == "delete") {
		if status.Code(getErr) != codes.NotFound {
			t.Fatalf("credentials recreated/not deleted: %v", getErr)
		}
	} else {
		want := "old-access"
		if change == "unchanged" {
			want = "refreshed"
		}
		if getErr != nil || snap.Data()["access_token"] != want {
			t.Fatalf("original credentials changed incorrectly: %v %v", snap, getErr)
		}
	}
}
