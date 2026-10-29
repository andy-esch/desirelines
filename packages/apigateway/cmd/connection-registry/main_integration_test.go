//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/connectionbootstrap"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/firestoretest"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRegistryCommandEndToEnd(t *testing.T) {
	postgresURL := os.Getenv("REGISTRY_TEST_POSTGRES_URL")
	if postgresURL == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("REGISTRY_TEST_POSTGRES_URL required in CI")
		}
		t.Skip("isolated registry_test Postgres fixture required")
	}
	parsed, err := url.Parse(postgresURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") || parsed.Path != "/registry_test" {
		t.Fatal("refusing non-local registry_test database")
	}
	authHost := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	if !strings.HasPrefix(authHost, "127.0.0.1:") && !strings.HasPrefix(authHost, "localhost:") {
		t.Fatal("local Auth emulator required")
	}
	t.Setenv("POSTGRES_CONNECTION_STRING", postgresURL)
	database := fmt.Sprintf("registry-command-%d", time.Now().UnixNano())
	t.Setenv("FIRESTORE_DATABASE", database)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	db := firestoretest.NewClient(t)
	pg, err := pgx.Connect(ctx, postgresURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pg.Close(ctx) }()
	// This explicitly named, isolated database contains only synthetic fixtures.
	_, err = pg.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS desirelines;
 CREATE TABLE IF NOT EXISTS desirelines.activities(id BIGINT PRIMARY KEY,user_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS desirelines.activity_external_ids(activity_id BIGINT,source TEXT,external_owner_id TEXT);
 TRUNCATE desirelines.activities,desirelines.activity_external_ids;
 INSERT INTO desirelines.activities VALUES(1,'123');
 INSERT INTO desirelines.activity_external_ids VALUES(1,'strava','123')`)
	if err != nil {
		t.Fatal(err)
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: "demo-test-project"})
	if err != nil {
		t.Fatal(err)
	}
	auth, err := app.Auth(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Auth records are server-seeded synthetic custom-auth users, no provider grant.
	if err := auth.DeleteUser(ctx, "123"); err != nil && !firebaseauth.IsUserNotFound(err) {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = auth.DeleteUser(context.Background(), "123") })
	imported, err := auth.ImportUsers(ctx, []*firebaseauth.UserToImport{
		(&firebaseauth.UserToImport{}).UID("123").Metadata(&firebaseauth.UserMetadata{CreationTimestamp: time.Now().UnixMilli(), LastLogInTimestamp: time.Now().UnixMilli()}),
	})
	if err != nil || imported.FailureCount != 0 {
		t.Fatalf("seed Auth: %+v %v", imported, err)
	}
	if _, err = db.Collection("allowlist").Doc("123").Set(ctx, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Collection("users").Doc("123").Collection("private").Doc("profile").Set(ctx, map[string]any{"strava_athlete_id": int64(123)}); err != nil {
		t.Fatal(err)
	}
	credentials := db.Collection("users").Doc("123").Collection("private").Doc("strava_tokens")
	if _, seedErr := credentials.Set(ctx, map[string]any{"access_token": "credential-canary-never-export"}); seedErr != nil {
		t.Fatal(seedErr)
	}
	base := []string{"--project=demo-test-project", "--database=" + database}
	var output bytes.Buffer
	execute := func(mode string, extra ...string) error {
		t.Helper()
		output.Reset()
		return run(ctx, append(append([]string{}, base...), append([]string{"--mode=" + mode}, extra...)...), &output)
	}
	var inventory bytes.Buffer
	if err = run(ctx, append(base, "--mode=inventory"), &inventory); err != nil {
		t.Fatal(err)
	}
	var report connectionbootstrap.Inventory
	if err = json.Unmarshal(inventory.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	// Other emulator Auth fixtures are explicitly excluded only when non-admitted.
	exclusions := map[string]string{}
	for _, issue := range report.Issues {
		if issue.UID != "123" && !issue.Blocking {
			exclusions[issue.UID] = "unrelated synthetic Auth fixture"
		}
	}
	manifest := connectionbootstrap.Manifest{Project: "demo-test-project", Database: database, PostgresTarget: report.PostgresTarget, OperationID: "test-command", ReviewedLegacyUIDs: true, UIDs: []string{"123"}, Excluded: exclusions}
	path := filepath.Join(t.TempDir(), "reviewed.json")
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"--manifest=" + path, "--confirm-project=demo-test-project"}
	if err = execute("apply", args...); err == nil {
		t.Fatal("apply before freeze accepted")
	}
	if err = execute("freeze", "--confirm-project=demo-test-project"); err != nil {
		t.Fatal(err)
	}
	if verifyErr := execute("verify", args...); verifyErr == nil || !strings.Contains(verifyErr.Error(), "resolve owner UID 123") {
		t.Fatalf("verify without applied mapping=%v", verifyErr)
	}
	for _, mode := range []string{"apply", "apply", "verify"} {
		if err = execute(mode, args...); err != nil {
			t.Fatalf("%s: %v inventory=%s", mode, err, inventory.String())
		}
	}
	if strings.Contains(inventory.String(), "credential-canary-never-export") {
		t.Fatal("inventory leaked credential data")
	}
	stored, readErr := credentials.Get(ctx)
	if readErr != nil || stored.Data()["access_token"] != "credential-canary-never-export" {
		t.Fatalf("bootstrap changed existing credentials: %v", readErr)
	}
	if _, deleteErr := credentials.Delete(ctx); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if verifyErr := execute("verify", args...); verifyErr == nil || !strings.Contains(verifyErr.Error(), "missing legacy documents") {
		t.Fatalf("missing credentials: %v", verifyErr)
	}
	credentialless := manifest
	credentialless.MissingLegacyDocuments = map[string][]string{"123": {"strava_tokens"}}
	credentiallessPath := filepath.Join(t.TempDir(), "missing-documents.json")
	writeCredentialless := func() {
		t.Helper()
		encoded, marshalErr := json.Marshal(credentialless)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if writeErr := os.WriteFile(credentiallessPath, encoded, 0o600); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	writeCredentialless()
	credentiallessArgs := []string{"--manifest=" + credentiallessPath, "--confirm-project=demo-test-project"}
	if verifyErr := execute("verify", credentiallessArgs...); verifyErr != nil {
		t.Fatalf("reviewed absent credentials: %v", verifyErr)
	}
	profile := db.Collection("users").Doc("123").Collection("private").Doc("profile")
	if _, deleteErr := profile.Delete(ctx); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if verifyErr := execute("verify", credentiallessArgs...); verifyErr == nil {
		t.Fatal("newly absent profile accepted against old acknowledgement")
	}
	credentialless.MissingLegacyDocuments["123"] = []string{"profile", "strava_tokens"}
	writeCredentialless()
	// Remove the first mapping, then bootstrap the admitted legacy owner with
	// neither private document. Only ownership routing may be created.
	for _, mode := range []string{"rollback", "apply", "verify"} {
		if operationErr := execute(mode, credentiallessArgs...); operationErr != nil {
			t.Fatalf("%s without provider documents: %v", mode, operationErr)
		}
	}
	for _, ref := range []*firestore.DocumentRef{profile, credentials} {
		if _, getErr := ref.Get(ctx); status.Code(getErr) != codes.NotFound {
			t.Fatalf("bootstrap created private document %s: %v", ref.ID, getErr)
		}
	}
	if _, seedErr := profile.Set(ctx, map[string]any{"strava_athlete_id": int64(123)}); seedErr != nil {
		t.Fatal(seedErr)
	}
	if _, seedErr := credentials.Set(ctx, map[string]any{"access_token": "credential-canary-never-export"}); seedErr != nil {
		t.Fatal(seedErr)
	}
	if verifyErr := execute("verify", credentiallessArgs...); verifyErr == nil {
		t.Fatal("stale absence acknowledgement accepted after documents restored")
	}
	previousOperation := manifest
	previousOperation.OperationID = "not-the-creator"
	previousPath := filepath.Join(t.TempDir(), "other-operation.json")
	previousData, marshalErr := json.Marshal(previousOperation)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if writeErr := os.WriteFile(previousPath, previousData, 0o600); writeErr != nil {
		t.Fatal(writeErr)
	}
	if rollbackErr := execute("rollback", "--manifest="+previousPath, "--confirm-project=demo-test-project"); rollbackErr == nil || !strings.Contains(rollbackErr.Error(), "matched no records") {
		t.Fatalf("wrong-operation rollback=%v", rollbackErr)
	}
	requireOwnerReceipt(t, output.String(), "123", "retained_other_operation")
	if verifyErr := execute("verify", args...); verifyErr != nil {
		t.Fatalf("rollback removed another operation's records: %v", verifyErr)
	}
	for name, mutation := range map[string]string{
		"unknown owner":            "UPDATE desirelines.activities SET user_id='999'",
		"wrong provider":           "UPDATE desirelines.activity_external_ids SET source='other'",
		"wrong external owner":     "UPDATE desirelines.activity_external_ids SET external_owner_id='999'",
		"missing external mapping": "DELETE FROM desirelines.activity_external_ids",
	} {
		t.Run(name, func(t *testing.T) {
			if _, mutateErr := pg.Exec(ctx, mutation); mutateErr != nil {
				t.Fatal(mutateErr)
			}
			t.Cleanup(func() {
				_, restoreErr := pg.Exec(ctx, `UPDATE desirelines.activities SET user_id='123';
 DELETE FROM desirelines.activity_external_ids;
 INSERT INTO desirelines.activity_external_ids VALUES(1,'strava','123')`)
				if restoreErr != nil {
					t.Fatal(restoreErr)
				}
			})
			if verifyErr := execute("verify", args...); verifyErr == nil || !strings.Contains(verifyErr.Error(), "persisted owner/source conflicts") {
				t.Fatalf("conflicting persisted ownership verified: %v", verifyErr)
			}
			if strings.Contains(output.String(), "verified_owners") {
				t.Fatal("failed inventory emitted a verification receipt")
			}
		})
	}
	// A SELECT that silently sees zero owners under RLS is not a valid inventory.
	if _, roleErr := pg.Exec(ctx, `DO $$ BEGIN CREATE ROLE registry_limited NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 GRANT USAGE ON SCHEMA desirelines TO registry_limited;
 GRANT SELECT ON ALL TABLES IN SCHEMA desirelines TO registry_limited;
 ALTER TABLE desirelines.activities ENABLE ROW LEVEL SECURITY;
 ALTER TABLE desirelines.activities FORCE ROW LEVEL SECURITY;`); roleErr != nil {
		t.Fatal(roleErr)
	}
	defer func() {
		if _, cleanupErr := pg.Exec(context.Background(), "ALTER TABLE desirelines.activities DISABLE ROW LEVEL SECURITY"); cleanupErr != nil {
			t.Error(cleanupErr)
		}
	}()
	roleURL := *parsed
	query := roleURL.Query()
	query.Set("role", "registry_limited")
	roleURL.RawQuery = query.Encode()
	t.Setenv("POSTGRES_CONNECTION_STRING", roleURL.String())
	if visibilityErr := execute("verify", args...); visibilityErr == nil || !strings.Contains(visibilityErr.Error(), "RLS-filtered") {
		t.Fatalf("filtered inventory: %v", visibilityErr)
	}
	if _, restoreErr := pg.Exec(ctx, "ALTER TABLE desirelines.activities DISABLE ROW LEVEL SECURITY"); restoreErr != nil {
		t.Fatal(restoreErr)
	}
	t.Setenv("POSTGRES_CONNECTION_STRING", postgresURL)
	// Dry run/verify never trusts client-writable profile metadata as identity.
	if _, err = profile.Update(ctx, []firestore.Update{{Path: "strava_athlete_id", Value: int64(999)}}); err != nil {
		t.Fatal(err)
	}
	if err = execute("verify", args...); err == nil {
		t.Fatal("tampered legacy profile was ignored")
	}
	if _, err = profile.Update(ctx, []firestore.Update{{Path: "strava_athlete_id", Value: int64(123)}}); err != nil {
		t.Fatal(err)
	}
	if err = execute("rollback", args...); err != nil {
		t.Fatal(err)
	}
	requireOwnerReceipt(t, output.String(), "123", "removed")
	if !strings.Contains(output.String(), "rolled-back users cannot start a new sign-in") {
		t.Fatal("rollback omitted the sign-in consequence")
	}
	if retryErr := execute("rollback", args...); retryErr != nil {
		t.Fatalf("idempotent rollback: %v", retryErr)
	}
	requireOwnerReceipt(t, output.String(), "123", "already_absent")
	if _, err = (activityconnection.Store{Client: db}).Resolve(ctx, "123"); err == nil {
		t.Fatal("rollback retained mapping")
	}
	if err = execute("apply", args...); err != nil {
		t.Fatal(err)
	}
	if err = execute("seal", "--confirm-project=demo-test-project"); err != nil {
		t.Fatal(err)
	}
	if err = execute("rollback", args...); err == nil {
		t.Fatal("sealed rollback accepted")
	}
	if err = execute("freeze", "--confirm-project=demo-test-project"); err == nil {
		t.Fatal("freeze reopened sealed rollback")
	}
	var owner string
	if err = pg.QueryRow(ctx, "SELECT user_id FROM desirelines.activities WHERE id=1").Scan(&owner); err != nil || owner != "123" {
		t.Fatalf("persisted ownership changed: %s %v", owner, err)
	}
}

func requireOwnerReceipt(t *testing.T, output, uid, outcome string) {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(output))
	for {
		var receipt map[string]any
		if err := decoder.Decode(&receipt); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		if receipt["uid"] == uid && receipt["outcome"] == outcome {
			return
		}
	}
	t.Fatalf("missing %s receipt for %s: %s", outcome, uid, output)
}

func TestPartialOwnerReceipts(t *testing.T) {
	database := fmt.Sprintf("registry-partial-%d", time.Now().UnixNano())
	t.Setenv("FIRESTORE_DATABASE", database)
	db := firestoretest.NewClient(t)
	if host := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"); !strings.HasPrefix(host, "127.0.0.1:") && !strings.HasPrefix(host, "localhost:") {
		t.Fatal("local Auth emulator required")
	}
	ctx := context.Background()
	app, appErr := firebase.NewApp(ctx, &firebase.Config{ProjectID: "demo-test-project"})
	if appErr != nil {
		t.Fatal(appErr)
	}
	auth, authErr := app.Auth(ctx)
	if authErr != nil {
		t.Fatal(authErr)
	}
	manifest := connectionbootstrap.Manifest{Project: "demo-test-project", Database: database, OperationID: "partial", UIDs: []string{"209001", "209002"}}
	store := activityconnection.Store{Client: db}
	if freezeErr := store.Freeze(ctx); freezeErr != nil {
		t.Fatal(freezeErr)
	}
	for _, uid := range manifest.UIDs {
		if _, createErr := auth.CreateUser(ctx, (&firebaseauth.UserToCreate{}).UID(uid)); createErr != nil {
			t.Fatal(createErr)
		}
		t.Cleanup(func() { _ = auth.DeleteUser(context.Background(), uid) })
		if _, seedErr := db.Collection("allowlist").Doc(uid).Set(ctx, map[string]any{}); seedErr != nil {
			t.Fatal(seedErr)
		}
	}
	var output bytes.Buffer
	// Auth admission can change between the reviewed inventory and each claim.
	if _, updateErr := auth.UpdateUser(ctx, "209001", (&firebaseauth.UserToUpdate{}).Disabled(true)); updateErr != nil {
		t.Fatal(updateErr)
	}
	if applyErr := applyOrVerify(ctx, modeApply, auth, store, &manifest, &output); applyErr == nil || !strings.Contains(applyErr.Error(), "provenance changed for 209001") {
		t.Fatalf("disabled Auth user applied: %v", applyErr)
	}
	if deleteErr := auth.DeleteUser(ctx, "209001"); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if applyErr := applyOrVerify(ctx, modeApply, auth, store, &manifest, &output); applyErr == nil || !strings.Contains(applyErr.Error(), "recheck Auth UID 209001") {
		t.Fatalf("deleted Auth user applied: %v", applyErr)
	}
	if _, resolveErr := store.Resolve(ctx, "209001"); !errors.Is(resolveErr, activityconnection.ErrNotFound) || output.Len() != 0 {
		t.Fatalf("failed Auth recheck created ownership or progress: %v %s", resolveErr, output.String())
	}
	if _, createErr := auth.CreateUser(ctx, (&firebaseauth.UserToCreate{}).UID("209001")); createErr != nil {
		t.Fatal(createErr)
	}
	// Model a conflict appearing after preflight, between per-owner commits.
	half := db.Collection("users").Doc("209002").Collection("connections").Doc("strava")
	if _, seedErr := half.Set(ctx, connectionbootstrap.Record("209002", "partial")); seedErr != nil {
		t.Fatal(seedErr)
	}
	if applyErr := applyOrVerify(ctx, modeApply, auth, store, &manifest, &output); applyErr == nil || !strings.Contains(applyErr.Error(), "209002") {
		t.Fatalf("partial apply=%v", applyErr)
	}
	requireOwnerReceipt(t, output.String(), "209001", "created")
	output.Reset()
	if rollbackErr := rollback(ctx, store, &manifest, &output); rollbackErr == nil || !strings.Contains(rollbackErr.Error(), "209002") {
		t.Fatalf("partial rollback=%v", rollbackErr)
	}
	requireOwnerReceipt(t, output.String(), "209001", "removed")
	if _, readErr := half.Get(ctx); readErr != nil {
		t.Fatalf("rollback erased the conflicting survivor: %v", readErr)
	}
}
