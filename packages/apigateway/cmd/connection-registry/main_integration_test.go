//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
)

func TestRegistryCommandEndToEnd(t *testing.T) {
	postgresURL := os.Getenv("REGISTRY_TEST_POSTGRES_URL")
	if postgresURL == "" {
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
	execute := func(mode string, extra ...string) error {
		t.Helper()
		return run(ctx, append(append([]string{}, base...), append([]string{"--mode=" + mode}, extra...)...), &bytes.Buffer{})
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
	for _, mode := range []string{"apply", "apply", "verify"} {
		if err = execute(mode, args...); err != nil {
			t.Fatalf("%s: %v inventory=%s", mode, err, inventory.String())
		}
	}
	if strings.Contains(inventory.String(), "credential-canary-never-export") {
		t.Fatal("inventory leaked credential data")
	}
	if _, deleteErr := credentials.Delete(ctx); deleteErr != nil {
		t.Fatal(deleteErr)
	}
	if verifyErr := execute("verify", args...); verifyErr == nil || !strings.Contains(verifyErr.Error(), "missing legacy credential") {
		t.Fatalf("missing credentials: %v", verifyErr)
	}
	if _, seedErr := credentials.Set(ctx, map[string]any{"access_token": "credential-canary-never-export"}); seedErr != nil {
		t.Fatal(seedErr)
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
	if rollbackErr := execute("rollback", "--manifest="+previousPath, "--confirm-project=demo-test-project"); rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	if verifyErr := execute("verify", args...); verifyErr != nil {
		t.Fatalf("rollback removed another operation's records: %v", verifyErr)
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
	profile := db.Collection("users").Doc("123").Collection("private").Doc("profile")
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
