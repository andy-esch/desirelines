package secrets_test

import (
	"os"
	"path/filepath"
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

func TestLoadFromMount_FileExistsEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := secrets.LoadFromMount(path, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty string", got)
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
	if want := "/nonexistent/path"; !contains(err.Error(), want) {
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

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
