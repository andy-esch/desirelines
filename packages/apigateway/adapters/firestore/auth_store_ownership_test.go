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
	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func credentialOwner(record *activityconnection.Record) auth.CredentialOwner {
	return auth.CredentialOwner{UID: record.UID, Subject: record.Subject}
}

func seedOwner(t *testing.T, store *AuthStore, uid, subject string) activityconnection.Record {
	t.Helper()
	owner := activityconnection.Record{SchemaVersion: 1, UID: uid, Provider: activityconnection.Provider, Subject: subject, Scopes: []string{}, Status: activityconnection.Active, Provenance: "oauth"}
	if uid == subject {
		owner.Provenance, owner.BootstrapID = activityconnection.LegacyUID, "test"
	}
	if err := writeFixture(context.Background(), store.client, map[string]any{"allowlist/" + uid: map[string]any{}, "provider_accounts/strava:" + subject: owner, "users/" + uid + "/connections/strava": owner}, nil); err != nil {
		t.Fatal(err)
	}
	return owner
}

func writeFixture(ctx context.Context, client *firestore.Client, sets map[string]any, deletes []string) error {
	err := client.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		for path, value := range sets {
			if setErr := tx.Set(client.Doc(path), value); setErr != nil {
				return fmt.Errorf("set fixture: %w", setErr)
			}
		}
		for _, path := range deletes {
			if deleteErr := tx.Delete(client.Doc(path)); deleteErr != nil {
				return fmt.Errorf("delete fixture: %w", deleteErr)
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("update fixture transaction: %w", err)
	}
	return nil
}

func grant(t *testing.T, subject string) (*stravatoken.Data, *auth.AthleteProfile) {
	t.Helper()
	id, parseErr := strconv.ParseInt(subject, 10, 64)
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	return &stravatoken.Data{AccessToken: "fresh-access", RefreshToken: "fresh-refresh", ExpiresAt: 2000000000},
		&auth.AthleteProfile{StravaAthleteID: id, FirstName: "Owner", CreatedAt: time.Now().Truncate(time.Millisecond)}
}

func assertNoCredentials(t *testing.T, store *AuthStore, uid string) {
	t.Helper()
	for _, name := range []string{"profile", "strava_tokens"} {
		_, err := store.client.Doc("users/" + uid + "/private/" + name).Get(context.Background())
		if status.Code(err) != codes.NotFound {
			t.Fatalf("unexpected %s for UID %q: %v", name, uid, err)
		}
	}
}

func TestAuthStoreUsesResolvedUID(t *testing.T) {
	for _, uid := range []string{"opaque-app-uid", "456", "123"} {
		t.Run(uid, func(t *testing.T) {
			store := newTestAuthStore(t)
			owner := seedOwner(t, store, uid, "123")
			tokens, profile := grant(t, owner.Subject)
			resolved, err := store.Resolve(context.Background(), owner.Subject)
			if err != nil || resolved.UID != uid {
				t.Fatalf("resolve = %+v, %v", resolved, err)
			}
			if writeErr := store.WriteAuthData(context.Background(), credentialOwner(&resolved), tokens, profile); writeErr != nil {
				t.Fatal(writeErr)
			}
			doc, err := store.client.Doc("users/" + uid + "/private/strava_tokens").Get(context.Background())
			if err != nil || doc.Data()["access_token"] != tokens.AccessToken {
				t.Fatalf("resolved UID credentials = %v, %v", doc, err)
			}
			if uid != owner.Subject {
				assertNoCredentials(t, store, owner.Subject)
			}
		})
	}
}

func TestAuthStoreRejectsUnusableOwnership(t *testing.T) {
	cases := []struct {
		name   string
		change func(*testing.T, *AuthStore, activityconnection.Record)
		want   error
	}{
		{"absent", func(t *testing.T, s *AuthStore, r activityconnection.Record) {
			deleteDoc(t, s, "provider_accounts/strava:"+r.Subject)
		}, activityconnection.ErrNotFound},
		{"incomplete", func(t *testing.T, s *AuthStore, r activityconnection.Record) {
			deleteDoc(t, s, "users/"+r.UID+"/connections/strava")
		}, activityconnection.ErrConflict},
		{"inactive", func(t *testing.T, s *AuthStore, r activityconnection.Record) {
			setField(t, s, "provider_accounts/strava:"+r.Subject, "status", "disconnected")
		}, activityconnection.ErrNotFound},
		{"conflicting", func(t *testing.T, s *AuthStore, r activityconnection.Record) {
			setField(t, s, "users/"+r.UID+"/connections/strava", "subject", "789")
		}, activityconnection.ErrConflict},
		{"admission removed", func(t *testing.T, s *AuthStore, r activityconnection.Record) { deleteDoc(t, s, "allowlist/"+r.UID) }, activityconnection.ErrAdmissionDenied},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestAuthStore(t)
			owner := seedOwner(t, store, "opaque-owner", "123")
			tokens, profile := grant(t, owner.Subject)
			tc.change(t, store, owner)
			if !errors.Is(tc.want, activityconnection.ErrAdmissionDenied) {
				if _, resolveErr := store.Resolve(context.Background(), owner.Subject); !errors.Is(resolveErr, tc.want) {
					t.Fatalf("resolver error = %v, want %v", resolveErr, tc.want)
				}
			}
			if err := store.WriteAuthData(context.Background(), credentialOwner(&owner), tokens, profile); !errors.Is(err, tc.want) {
				t.Fatalf("write error = %v, want %v", err, tc.want)
			}
			assertNoCredentials(t, store, owner.UID)
			assertNoCredentials(t, store, owner.Subject)
		})
	}
}

func deleteDoc(t *testing.T, s *AuthStore, path string) {
	t.Helper()
	if _, err := s.client.Doc(path).Delete(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func setField(t *testing.T, s *AuthStore, path, field string, value any) {
	t.Helper()
	if _, err := s.client.Doc(path).Update(context.Background(), []firestore.Update{{Path: field, Value: value}}); err != nil {
		t.Fatal(err)
	}
}

// abortFirstCommit uses a real emulator transaction. It rolls back the first
// snapshot before changing state, then makes the SDK retry the callback. This
// avoids depending on emulator timing or trying to mutate a locked document.
func abortFirstCommit(t *testing.T, change func(context.Context) error) (*AuthStore, *atomic.Int32) {
	t.Helper()
	var commits, begins atomic.Int32
	intercept := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoke grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer owner")
		if strings.HasSuffix(method, "/BeginTransaction") {
			begins.Add(1)
		}
		if strings.HasSuffix(method, "/Commit") && commits.Add(1) == 1 {
			commit, ok := req.(*firestorepb.CommitRequest)
			if !ok {
				return status.Error(codes.Internal, "unexpected commit request type")
			}
			if _, err := firestorepb.NewFirestoreClient(cc).Rollback(ctx, &firestorepb.RollbackRequest{Database: commit.Database, Transaction: commit.Transaction}); err != nil {
				return fmt.Errorf("abort fixture snapshot: %w", err)
			}
			if err := change(ctx); err != nil {
				return err
			}
			return status.Error(codes.Aborted, "exercise SDK transaction retry")
		}
		return invoke(ctx, method, req, reply, cc, opts...)
	}
	// Refuse missing emulator configuration; this connection carries no real credentials.
	if strings.TrimSpace(os.Getenv("FIRESTORE_EMULATOR_HOST")) == "" {
		t.Fatal("Firestore emulator required")
	}
	stream := func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		return streamer(metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer owner"), desc, cc, method, opts...)
	}
	conn, err := grpc.NewClient(os.Getenv("FIRESTORE_EMULATOR_HOST"), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithUnaryInterceptor(intercept), grpc.WithStreamInterceptor(stream))
	if err != nil {
		t.Fatal(err)
	}
	client, err := firestore.NewClientWithDatabase(context.Background(), cmp.Or(os.Getenv("GCP_PROJECT_ID"), "test-project"), os.Getenv("FIRESTORE_DATABASE"), option.WithoutAuthentication(), option.WithGRPCConn(conn))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	return NewAuthStore(client), &begins
}

func TestAuthStoreRetryRevalidatesOrigin(t *testing.T) {
	for _, change := range []string{"reassigned", "admission removed", "deleted"} {
		t.Run(change, func(t *testing.T) {
			base := newTestAuthStore(t)
			owner := seedOwner(t, base, "original-app-uid", "123")
			tokens, profile := grant(t, owner.Subject)
			store, begins := abortFirstCommit(t, func(ctx context.Context) error {
				sets := map[string]any{}
				var deletes []string
				switch change {
				case "reassigned":
					moved := owner
					moved.UID = owner.Subject
					deletes = []string{"users/" + owner.UID + "/connections/strava"}
					sets["provider_accounts/strava:"+owner.Subject] = moved
					sets["users/"+moved.UID+"/connections/strava"] = moved
					sets["allowlist/"+moved.UID] = map[string]any{}
				case "admission removed":
					deletes = []string{"allowlist/" + owner.UID}
				case "deleted":
					deletes = []string{"allowlist/" + owner.UID, "provider_accounts/strava:" + owner.Subject, "users/" + owner.UID + "/connections/strava", "users/" + owner.UID + "/private/profile", "users/" + owner.UID + "/private/strava_tokens"}
				}
				return writeFixture(ctx, base.client, sets, deletes)
			})
			err := store.WriteAuthData(context.Background(), credentialOwner(&owner), tokens, profile)
			want := activityconnection.ErrConflict
			switch change {
			case "admission removed":
				want = activityconnection.ErrAdmissionDenied
			case "deleted":
				want = activityconnection.ErrNotFound
			}
			if !errors.Is(err, want) {
				t.Fatalf("write error = %v, want %v", err, want)
			}
			if begins.Load() != 2 {
				t.Fatalf("SDK attempts = %d, want 2", begins.Load())
			}
			assertNoCredentials(t, base, owner.UID)
			assertNoCredentials(t, base, owner.Subject)
		})
	}
}

func TestAuthStoreRetryPreservesCreatedAtWithoutMutatingInput(t *testing.T) {
	base := newTestAuthStore(t)
	owner := seedOwner(t, base, "stable-app-uid", "123")
	tokens, profile := grant(t, owner.Subject)
	inputTime := profile.CreatedAt
	firstLogin := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if _, err := base.client.Doc("users/"+owner.UID+"/private/profile").Set(context.Background(), &auth.AthleteProfile{CreatedAt: firstLogin}); err != nil {
		t.Fatal(err)
	}
	store, begins := abortFirstCommit(t, func(context.Context) error { return nil })
	if err := store.WriteAuthData(context.Background(), credentialOwner(&owner), tokens, profile); err != nil {
		t.Fatal(err)
	}
	if begins.Load() != 2 || !profile.CreatedAt.Equal(inputTime) {
		t.Fatalf("retry mutated input: attempts=%d profile=%+v", begins.Load(), profile)
	}
	doc, err := base.client.Doc("users/" + owner.UID + "/private/profile").Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var stored auth.AthleteProfile
	if decodeErr := doc.DataTo(&stored); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if !stored.CreatedAt.Equal(firstLogin) {
		t.Fatalf("CreatedAt = %v, want %v", stored.CreatedAt, firstLogin)
	}
}
