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
	"google.golang.org/api/option"
)

// emulatorHostEnv is the variable the Firestore SDK reads to target the emulator.
const emulatorHostEnv = "FIRESTORE_EMULATOR_HOST"

// errNoEmulator reports that no Firestore emulator is configured.
var errNoEmulator = errors.New(emulatorHostEnv + " is not set, so a Firestore client would reach real Google Cloud with Application Default Credentials")

// emulatorHost returns the configured emulator address, or errNoEmulator.
func emulatorHost() (string, error) {
	host := strings.TrimSpace(os.Getenv(emulatorHostEnv))
	if host == "" {
		return "", errNoEmulator
	}
	return host, nil
}

// requireEmulator returns the emulator address, or ends the test and returns
// "": it skips locally and fails when CI is "true", where a missing emulator is
// a setup error rather than an optional suite.
func requireEmulator(tb testing.TB) string {
	tb.Helper()
	host, err := emulatorHost()
	if err == nil {
		return host
	}
	msg := err.Error() + "; start the emulator and set it (see docs/guides/local-testing.md)"
	if os.Getenv("CI") == "true" {
		tb.Fatal(msg)
	} else {
		tb.Skip(msg)
	}
	return ""
}

// NewClient returns a Firestore client for the emulator, closed when the test
// ends. Without an emulator configured it ends the test (see requireEmulator)
// and builds nothing. GCP_PROJECT_ID and FIRESTORE_DATABASE pick the project and
// database (the emulator accepts any values) and default to test-project and
// test-db.
func NewClient(tb testing.TB) *firestore.Client {
	tb.Helper()
	// Skip and Fatal end a real test, but a testing.TB wrapper might not, so
	// stop here as well. The client also carries no credentials, so even a
	// bypassed check could not authenticate to a real project.
	if requireEmulator(tb) == "" {
		return nil
	}
	projectID := cmp.Or(os.Getenv("GCP_PROJECT_ID"), "test-project")
	database := cmp.Or(os.Getenv("FIRESTORE_DATABASE"), "test-db")
	client, err := firestore.NewClientWithDatabase(context.Background(), projectID, database, option.WithoutAuthentication())
	if err != nil {
		tb.Fatalf("create Firestore emulator client: %v", err)
		return nil
	}
	tb.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			tb.Errorf("close Firestore client: %v", closeErr)
		}
	})
	return client
}
