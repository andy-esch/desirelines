package firestoretest

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"cloud.google.com/go/firestore"
)

// fakeTB records how a helper ended a test. With ends set, Skip and Fatal end
// the calling goroutine, as they do on a real *testing.T; without it they only
// record, like a testing.TB wrapper that does not stop the test.
type fakeTB struct {
	testing.TB
	ends     bool
	skipped  bool
	failed   bool
	errored  bool
	messages []string
	cleanups []func()
}

func (f *fakeTB) Helper() {}

func (f *fakeTB) Skip(args ...any) {
	f.skipped = true
	f.messages = append(f.messages, fmt.Sprint(args...))
	if f.ends {
		runtime.Goexit()
	}
}

func (f *fakeTB) Fatal(args ...any) {
	f.failed = true
	f.messages = append(f.messages, fmt.Sprint(args...))
	if f.ends {
		runtime.Goexit()
	}
}

func (f *fakeTB) Fatalf(format string, args ...any) { f.Fatal(fmt.Sprintf(format, args...)) }

func (f *fakeTB) Errorf(format string, args ...any) {
	f.errored = true
	f.messages = append(f.messages, fmt.Sprintf(format, args...))
}

func (f *fakeTB) Cleanup(fn func()) { f.cleanups = append(f.cleanups, fn) }

// runHelper calls fn on its own goroutine, as the testing package runs a test,
// and reports whether fn returned rather than being ended by Skip or Fatal.
func runHelper(tb *fakeTB, fn func(testing.TB)) (returned bool) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		fn(tb)
		returned = true
	}()
	<-done
	return returned
}

// withoutEmulator clears the emulator setting and points Application Default
// Credentials at a well-formed file, so a client built past the guard would
// authenticate as a real user.
func withoutEmulator(t *testing.T, ci string) {
	t.Helper()
	adc := filepath.Join(t.TempDir(), "adc.json")
	// Fake but well-formed: the SDK accepts it without a network call.
	content := `{"type":"authorized_user","client_id":"id","client_secret":"fake","refresh_token":"fake"}`
	if err := os.WriteFile(adc, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", adc)
	t.Setenv(emulatorHostEnv, "")
	t.Setenv("CI", ci)
}

func TestEmulatorHost(t *testing.T) {
	for _, value := range []string{"", "   "} {
		t.Setenv(emulatorHostEnv, value)
		if _, err := emulatorHost(); !errors.Is(err, errNoEmulator) {
			t.Errorf("emulatorHost() with %q: error = %v, want errNoEmulator", value, err)
		}
	}
	t.Setenv(emulatorHostEnv, "localhost:8080")
	if host, err := emulatorHost(); err != nil || host != "localhost:8080" {
		t.Errorf("emulatorHost() = %q, %v; want localhost:8080, nil", host, err)
	}
}

// Without an emulator, NewClient ends the test before building a client: it
// skips locally and fails in CI.
func TestNewClient_EndsTheTestWithoutAnEmulator(t *testing.T) {
	for _, tc := range []struct {
		name, ci        string
		skipped, failed bool
	}{
		{name: "skips locally", ci: "", skipped: true},
		{name: "fails in CI", ci: "true", failed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withoutEmulator(t, tc.ci)
			tb := &fakeTB{ends: true}

			if runHelper(tb, func(tb testing.TB) { NewClient(tb) }) {
				t.Fatal("NewClient returned without an emulator")
			}
			if tb.skipped != tc.skipped || tb.failed != tc.failed {
				t.Errorf("skipped=%v failed=%v, want skipped=%v failed=%v", tb.skipped, tb.failed, tc.skipped, tc.failed)
			}
			if len(tb.messages) != 1 || !strings.Contains(tb.messages[0], errNoEmulator.Error()) {
				t.Errorf("messages = %q, want one naming the missing emulator", tb.messages)
			}
			if len(tb.cleanups) != 0 {
				t.Errorf("registered %d cleanups, want none: no client may exist", len(tb.cleanups))
			}
		})
	}
}

// If Skip and Fatal do not end the test, NewClient still builds nothing.
func TestNewClient_StopsEvenWhenSkipDoesNotEndTheTest(t *testing.T) {
	for _, ci := range []string{"", "true"} {
		withoutEmulator(t, ci)
		tb := &fakeTB{}
		var client *firestore.Client

		if !runHelper(tb, func(tb testing.TB) { client = NewClient(tb) }) {
			t.Fatal("NewClient did not return")
		}
		if client != nil {
			t.Errorf("CI=%q: NewClient built a client without an emulator", ci)
		}
		if len(tb.cleanups) != 0 {
			t.Errorf("CI=%q: registered %d cleanups, want none", ci, len(tb.cleanups))
		}
	}
}

// With an emulator configured, NewClient builds a client lazily (no connection
// is made until the first call) and closes it when the test ends.
func TestNewClient_BuildsAndClosesAnEmulatorClient(t *testing.T) {
	t.Setenv(emulatorHostEnv, "localhost:1")
	tb := &fakeTB{ends: true}

	if !runHelper(tb, func(tb testing.TB) {
		if NewClient(tb) == nil {
			t.Error("NewClient returned nil with an emulator configured")
		}
	}) {
		t.Fatalf("NewClient ended the test: %q", tb.messages)
	}
	if len(tb.cleanups) != 1 {
		t.Fatalf("registered %d cleanups, want 1", len(tb.cleanups))
	}
	tb.cleanups[0]()
	if tb.errored {
		t.Errorf("closing the client reported %q", tb.messages)
	}
	// Closing twice fails, which the cleanup reports rather than ignores.
	tb.cleanups[0]()
	if !tb.errored {
		t.Error("a failed close was not reported")
	}
}

// An emulator address the SDK cannot use fails the test instead of falling back.
func TestNewClient_FailsOnAnUnusableEmulatorAddress(t *testing.T) {
	t.Setenv(emulatorHostEnv, "%zz")
	tb := &fakeTB{ends: true}

	if runHelper(tb, func(tb testing.TB) { NewClient(tb) }) {
		t.Fatal("NewClient returned with an unusable emulator address")
	}
	if !tb.failed || len(tb.messages) != 1 || !strings.Contains(tb.messages[0], "create Firestore emulator client") {
		t.Errorf("failed=%v messages=%q, want one client creation failure", tb.failed, tb.messages)
	}
}
