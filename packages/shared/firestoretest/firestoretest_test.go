package firestoretest

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// childEnv marks a re-executed copy of this test binary that should call
// NewClient without an emulator.
const childEnv = "FIRESTORETEST_CHILD"

// reachedClient is printed if NewClient returns, which it must not.
const reachedClient = "NewClient returned a client without an emulator"

func TestEmulatorHost(t *testing.T) {
	for _, value := range []string{"", "   "} {
		t.Setenv(EmulatorHostEnv, value)
		if _, err := EmulatorHost(); !errors.Is(err, ErrNoEmulator) {
			t.Errorf("EmulatorHost() with %q: error = %v, want ErrNoEmulator", value, err)
		}
	}
	t.Setenv(EmulatorHostEnv, "localhost:8080")
	if host, err := EmulatorHost(); err != nil || host != "localhost:8080" {
		t.Errorf("EmulatorHost() = %q, %v; want localhost:8080, nil", host, err)
	}
}

// Without an emulator, NewClient must end the test before any client exists,
// even when Application Default Credentials are present: skipped locally, failed
// in CI. Skip and Fatal end the goroutine that calls them, so the check runs in a
// child copy of this test binary and inspects its output.
func TestNewClient_EndsTheTestWithoutAnEmulator(t *testing.T) {
	if os.Getenv(childEnv) == "1" {
		NewClient(t)
		t.Fatal(reachedClient)
	}

	adc := filepath.Join(t.TempDir(), "adc.json")
	if err := os.WriteFile(adc, []byte(`{"type":"authorized_user"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, ci, verdict string
		wantExitErr       bool
	}{
		{name: "skips locally", ci: "", verdict: "--- SKIP", wantExitErr: false},
		{name: "fails in CI", ci: "true", verdict: "--- FAIL", wantExitErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			//nolint:gosec // Re-runs this test binary with a fixed test filter.
			cmd := exec.Command(os.Args[0], "-test.run=^TestNewClient_EndsTheTestWithoutAnEmulator$", "-test.v")
			cmd.Env = append(os.Environ(), childEnv+"=1", EmulatorHostEnv+"=", "CI="+tc.ci,
				"GOOGLE_APPLICATION_CREDENTIALS="+adc)
			out, err := cmd.CombinedOutput()
			output := string(out)
			if (err != nil) != tc.wantExitErr {
				t.Fatalf("child exit error = %v, want error: %v\n%s", err, tc.wantExitErr, output)
			}
			if !strings.Contains(output, tc.verdict) || !strings.Contains(output, ErrNoEmulator.Error()) {
				t.Errorf("child output lacks %q and the missing-emulator message:\n%s", tc.verdict, output)
			}
			if strings.Contains(output, reachedClient) {
				t.Errorf("NewClient returned without an emulator:\n%s", output)
			}
		})
	}
}
