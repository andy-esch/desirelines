package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/connectionbootstrap"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

func TestRefuseBeforeCreatingClients(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--project=demo-test-project"},
		{"--project=demo-test-project", "--database=test", "--mode=erase"},
		{"--project=demo-test-project", "--database=test", "--mode=freeze"},
		{"--project=demo-test-project", "--database=test", "--mode=apply", "--confirm-project=other"},
	} {
		if err := run(context.Background(), args, io.Discard); err == nil {
			t.Fatalf("accepted unsafe command: %v", args)
		}
	}
}

func TestManifestRejectsUnknownTrailingAndOversizedData(t *testing.T) {
	valid := `{"project":"demo-test-project","database":"test","postgres_target":"localhost:5432/test","operation_id":"test","reviewed_legacy_uids":true,"uids":[],"excluded":{}}`
	for name, data := range map[string]string{
		"unknown":   strings.TrimSuffix(valid, "}") + `,"unknown":true}`,
		"trailing":  valid + ` {}`,
		"oversized": valid + strings.Repeat(" ", 1<<20) + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "manifest.json")
			if writeErr := os.WriteFile(path, []byte(data), 0o600); writeErr != nil {
				t.Fatal(writeErr)
			}
			if _, readErr := readManifest(&options{mode: modeApply, project: "demo-test-project", database: "test", manifest: path}); readErr == nil {
				t.Fatal("invalid manifest accepted")
			}
		})
	}
}

func TestManifestRejectsUnreadableAndInvalidFiles(t *testing.T) {
	root := t.TempDir()
	for name, data := range map[string]string{"empty": "", "invalid JSON": "{", "unreviewed": `{"project":"demo-test-project","database":"test","postgres_target":"localhost:5432/test","operation_id":"operation"}`} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(root, name+".json")
			if writeErr := os.WriteFile(path, []byte(data), 0o600); writeErr != nil {
				t.Fatal(writeErr)
			}
			if _, manifestErr := readManifest(&options{mode: modeApply, project: "demo-test-project", database: "test", manifest: path}); manifestErr == nil {
				t.Fatal("unreviewed manifest accepted")
			}
		})
	}
	for _, path := range []string{filepath.Join(root, "missing.json"), root} {
		if _, manifestErr := readManifest(&options{mode: modeApply, project: "demo-test-project", database: "test", manifest: path}); manifestErr == nil {
			t.Fatal("unreadable manifest accepted")
		}
	}
	if _, parseErr := parseOptions([]string{"--unknown"}); parseErr == nil {
		t.Fatal("unknown flag accepted")
	}
}

func TestMainCodeReturnsFailureWithoutExplicitTarget(t *testing.T) {
	previous := os.Args
	t.Cleanup(func() { os.Args = previous })
	os.Args = []string{"connection-registry"}
	if code := mainCode(); code != 1 {
		t.Fatalf("unsafe invocation exit=%d", code)
	}
}

func TestMissingDatabaseCannotProduceVerification(t *testing.T) {
	t.Setenv("POSTGRES_CONNECTION_STRING", "")
	if inventoryErr := inventoryOperation(context.Background(), &options{}, nil, activityconnection.Store{}, &connectionbootstrap.Manifest{}, io.Discard); inventoryErr == nil {
		t.Fatal("missing database configuration accepted")
	}
}
