package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
