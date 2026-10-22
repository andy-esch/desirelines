// Package firestoretest gives Firestore integration tests a client that can only
// reach the Firestore emulator.
//
// The Firestore SDK targets the emulator when FIRESTORE_EMULATOR_HOST is set and
// otherwise real Google Cloud, using whatever Application Default Credentials
// the machine holds. A test that built a client without the emulator configured
// would read and write a real project. NewClient checks first, so integration
// tests should get their client from it rather than from the SDK directly.
package firestoretest

import (
	"cmp"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"cloud.google.com/go/firestore"
)

// EmulatorHostEnv is the variable the Firestore SDK reads to target the emulator.
const EmulatorHostEnv = "FIRESTORE_EMULATOR_HOST"

// ErrNoEmulator reports that no Firestore emulator is configured.
var ErrNoEmulator = errors.New(EmulatorHostEnv + " is not set, so a Firestore client would reach real Google Cloud with Application Default Credentials")

// EmulatorHost returns the configured emulator address, or ErrNoEmulator.
func EmulatorHost() (string, error) {
	host := strings.TrimSpace(os.Getenv(EmulatorHostEnv))
	if host == "" {
		return "", ErrNoEmulator
	}
	return host, nil
}

// RequireEmulator returns the emulator address, or ends the test: it skips
// locally and fails when CI is "true", where a missing emulator is a setup
// error rather than an optional suite.
func RequireEmulator(tb testing.TB) string {
	tb.Helper()
	host, err := EmulatorHost()
	if err == nil {
		return host
	}
	msg := err.Error() + "; start the emulator and set it (see docs/guides/local-testing.md)"
	if os.Getenv("CI") == "true" {
		tb.Fatal(msg)
	}
	tb.Skip(msg)
	return ""
}

// NewClient returns a Firestore client for the emulator, closed when the test
// ends. It calls RequireEmulator before building anything. GCP_PROJECT_ID and
// FIRESTORE_DATABASE pick the project and database (the emulator accepts any
// values) and default to test-project and test-db.
func NewClient(tb testing.TB) *firestore.Client {
	tb.Helper()
	RequireEmulator(tb)
	projectID := cmp.Or(os.Getenv("GCP_PROJECT_ID"), "test-project")
	database := cmp.Or(os.Getenv("FIRESTORE_DATABASE"), "test-db")
	client, err := firestore.NewClientWithDatabase(context.Background(), projectID, database)
	if err != nil {
		tb.Fatalf("create Firestore emulator client: %v", err)
	}
	tb.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			tb.Errorf("close Firestore client: %v", closeErr)
		}
	})
	return client
}
