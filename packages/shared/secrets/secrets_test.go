package secrets_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/secrets"
)

func TestLoadFromMount_FileExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("  file-value\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := secrets.LoadFromMount(path, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "file-value" {
		t.Errorf("got %q, want %q", got, "file-value")
	}
}

// A present-but-empty mount must not be reported as a successful load. Before
// this, LoadFromMount returned ("", nil) here, so a caller could not tell an
// empty secret from a good one — and the apigateway would go on to sign OAuth
// state tokens with an empty HMAC key.
func TestLoadFromMount_FileExistsEmpty(t *testing.T) {
	for _, tc := range []struct {
		name     string
		contents string
	}{
		{"empty", ""},
		{"whitespace only", "   \n\t  \n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "secret")
			if err := os.WriteFile(path, []byte(tc.contents), 0o600); err != nil {
				t.Fatal(err)
			}

			got, err := secrets.LoadFromMount(path, "")
			if err == nil {
				t.Fatalf("expected an error, got %q with nil error", got)
			}
			if got != "" {
				t.Errorf("got %q, want empty string alongside the error", got)
			}
		})
	}
}

// An empty mount must not shadow a usable environment variable. This is the
// case the old behavior got most wrong: it returned "" successfully and the
// documented fallback never ran.
func TestLoadFromMount_FileExistsEmpty_FallsBackToEnv(t *testing.T) {
	const envKey = "TEST_SECRET_EMPTY_MOUNT_FALLBACK"

	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envKey, "from-env")

	got, err := secrets.LoadFromMount(path, envKey)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "from-env" {
		t.Errorf("got %q, want %q", got, "from-env")
	}
}

func TestLoadFromMount_FileMissing_EnvSet(t *testing.T) {
	const envKey = "TEST_SECRET_FALLBACK"
	t.Setenv(envKey, "env-value")

	got, err := secrets.LoadFromMount("/nonexistent/path", envKey)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "env-value" {
		t.Errorf("got %q, want %q", got, "env-value")
	}
}

func TestLoadFromMount_FileMissing_EnvEmpty(t *testing.T) {
	_, err := secrets.LoadFromMount("/nonexistent/path", "")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if want := "/nonexistent/path"; !strings.Contains(err.Error(), want) {
		t.Errorf("error %q should contain %q", err.Error(), want)
	}
}

func TestLoadFromMount_FileMissing_EnvKeySetButEmpty(t *testing.T) {
	const envKey = "TEST_SECRET_EMPTY"
	t.Setenv(envKey, "")

	_, err := secrets.LoadFromMount("/nonexistent/path", envKey)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}
