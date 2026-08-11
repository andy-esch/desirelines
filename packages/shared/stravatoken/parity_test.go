// Parity guard for the Firestore strava_tokens document.
//
// The document at users/{athleteID}/private/strava_tokens is a three-service
// contract: apigateway writes it on the OAuth callback, dispatcher reads and
// rewrites it on every refresh, and stravapipe reads it for backfill. Two of
// those are Go and one is Python, so the shape is only type-checked on one
// edge — a field rename on either side would otherwise surface as a runtime
// decode failure in production rather than a red test.
//
// This file and its Python counterpart
// (packages/stravapipe/tests/unit/adapters/firestore/test_token_store_parity.py)
// read the SAME fixture, schemas/test-fixtures/strava_tokens.json. Adding a
// field on one side without the other now fails here or there.
package stravatoken

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

type tokenFixture struct {
	Name     string         `json:"name"`
	Doc      map[string]any `json:"doc"`
	Expected struct {
		AccessToken   string `json:"access_token"`
		RefreshToken  string `json:"refresh_token"`
		ExpiresAt     int64  `json:"expires_at"`
		Scopes        string `json:"scopes"`
		ConnectedAt   string `json:"connected_at"`
		LastRefreshed string `json:"last_refreshed"`
	} `json:"expected"`
}

func loadTokenFixtures(t *testing.T) []tokenFixture {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot determine test file location")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "..", "schemas", "test-fixtures", "strava_tokens.json")
	data, err := os.ReadFile(path) //nolint:gosec // path is relative to this test file
	if err != nil {
		t.Fatalf("read shared fixtures: %v", err)
	}
	var fixtures []tokenFixture
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatalf("parse shared fixtures: %v", err)
	}
	if len(fixtures) == 0 {
		t.Fatal("shared fixtures are empty")
	}
	return fixtures
}

// decodeLikeFirestore mirrors what the Firestore client does with the
// `firestore:"..."` tags: map document keys onto fields, leaving anything
// absent at its zero value. Reimplemented here rather than spun up against a
// real client so the parity check stays a unit test.
func decodeLikeFirestore(t *testing.T, doc map[string]any) Data {
	t.Helper()
	var d Data
	if v, ok := doc["access_token"].(string); ok {
		d.AccessToken = v
	}
	if v, ok := doc["refresh_token"].(string); ok {
		d.RefreshToken = v
	}
	if v, ok := doc["expires_at"].(float64); ok {
		d.ExpiresAt = int64(v)
	}
	if v, ok := doc["scopes"].(string); ok {
		d.Scopes = v
	}
	if v, ok := doc["connected_at"].(string); ok {
		ts, err := time.Parse(time.RFC3339, v)
		if err != nil {
			t.Fatalf("connected_at %q: %v", v, err)
		}
		d.ConnectedAt = ts
	}
	if v, ok := doc["last_refreshed"].(string); ok {
		ts, err := time.Parse(time.RFC3339, v)
		if err != nil {
			t.Fatalf("last_refreshed %q: %v", v, err)
		}
		d.LastRefreshed = ts
	}
	return d
}

func TestSharedFixtures_StravaTokensDecode(t *testing.T) {
	for _, f := range loadTokenFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			got := decodeLikeFirestore(t, f.Doc)

			if got.AccessToken != f.Expected.AccessToken {
				t.Errorf("access_token = %q, want %q", got.AccessToken, f.Expected.AccessToken)
			}
			if got.RefreshToken != f.Expected.RefreshToken {
				t.Errorf("refresh_token = %q, want %q", got.RefreshToken, f.Expected.RefreshToken)
			}
			if got.ExpiresAt != f.Expected.ExpiresAt {
				t.Errorf("expires_at = %d, want %d", got.ExpiresAt, f.Expected.ExpiresAt)
			}
			if got.Scopes != f.Expected.Scopes {
				t.Errorf("scopes = %q, want %q", got.Scopes, f.Expected.Scopes)
			}
			wantConnected, err := time.Parse(time.RFC3339, f.Expected.ConnectedAt)
			if err != nil {
				t.Fatalf("fixture connected_at: %v", err)
			}
			if !got.ConnectedAt.Equal(wantConnected) {
				t.Errorf("connected_at = %v, want %v", got.ConnectedAt, wantConnected)
			}
			wantRefreshed, err := time.Parse(time.RFC3339, f.Expected.LastRefreshed)
			if err != nil {
				t.Fatalf("fixture last_refreshed: %v", err)
			}
			if !got.LastRefreshed.Equal(wantRefreshed) {
				t.Errorf("last_refreshed = %v, want %v", got.LastRefreshed, wantRefreshed)
			}
		})
	}
}

// TestSharedFixtures_StravaTokensFieldCoverage is the half that actually
// catches drift. The decode test above would still pass if someone added a
// field to Data and to the fixture but not to Python — this asserts the fixture
// names exactly the tags Data declares, so a new Go field forces a fixture
// change, which in turn breaks Python until it is taught the field.
func TestSharedFixtures_StravaTokensFieldCoverage(t *testing.T) {
	// Reflected off Data rather than hand-listed: a hardcoded list cannot
	// notice a field being added, which is the exact drift this test exists to
	// catch. Adding a field to Data now fails here until the shared fixture
	// carries it — and that fixture change is what fails Python until it too
	// is taught the field.
	declared := map[string]bool{}
	dt := reflect.TypeOf(Data{})
	for i := range dt.NumField() {
		tag := dt.Field(i).Tag.Get("firestore")
		if tag == "" || tag == "-" {
			t.Errorf("Data.%s has no firestore tag; it cannot participate in the contract", dt.Field(i).Name)
			continue
		}
		declared[tag] = true
	}

	fixtures := loadTokenFixtures(t)
	full := fixtures[0]
	if full.Name != "all fields present" {
		t.Fatalf("fixture[0] = %q, want the fully-populated case first", full.Name)
	}
	for tag := range declared {
		if _, ok := full.Doc[tag]; !ok {
			t.Errorf("Data declares %q but fixture %q omits it, so no cross-language test covers it", tag, full.Name)
		}
	}
	for key := range full.Doc {
		if !declared[key] {
			t.Errorf("fixture carries %q, which stravatoken.Data does not declare", key)
		}
	}
}

// TestValidate_MatchesPythonStrictness pins the Go/Python alignment decided on
// 2026-08-11: a document missing a credential must be rejected on both edges,
// not silently zero-filled on the Go side.
//
// The exclusions are as deliberate as the inclusions — see Validate's doc
// comment. scopes is legitimately absent (Strava's token response does not
// reliably carry it, and webhooks never do), and a zero last_refreshed is the
// real "connected but never refreshed" state that the shared fixture encodes.
func TestValidate_MatchesPythonStrictness(t *testing.T) {
	complete := func() Data {
		return Data{
			AccessToken:   "acc",
			RefreshToken:  "ref",
			ExpiresAt:     1735689600,
			Scopes:        "read",
			ConnectedAt:   time.Unix(1704067200, 0),
			LastRefreshed: time.Unix(1735689600, 0),
		}
	}

	t.Run("complete document is valid", func(t *testing.T) {
		d := complete()
		if err := d.Validate(); err != nil {
			t.Errorf("Validate() = %v, want nil", err)
		}
	})

	required := map[string]func(*Data){
		"access_token":  func(d *Data) { d.AccessToken = "" },
		"refresh_token": func(d *Data) { d.RefreshToken = "" },
		"expires_at":    func(d *Data) { d.ExpiresAt = 0 },
	}
	for field, blank := range required {
		t.Run("missing "+field+" is rejected", func(t *testing.T) {
			d := complete()
			blank(&d)
			err := d.Validate()
			if err == nil {
				t.Fatalf("Validate() = nil, want an error for a missing %s", field)
			}
			if !errors.Is(err, ErrIncompleteTokens) {
				t.Errorf("Validate() = %v, want it to wrap ErrIncompleteTokens", err)
			}
			if !strings.Contains(err.Error(), field) {
				t.Errorf("Validate() = %v, want the message to name %q", err, field)
			}
		})
	}

	optional := map[string]func(*Data){
		"scopes":         func(d *Data) { d.Scopes = "" },
		"connected_at":   func(d *Data) { d.ConnectedAt = time.Time{} },
		"last_refreshed": func(d *Data) { d.LastRefreshed = time.Time{} },
	}
	for field, blank := range optional {
		t.Run("absent "+field+" is still valid", func(t *testing.T) {
			d := complete()
			blank(&d)
			if err := d.Validate(); err != nil {
				t.Errorf("Validate() = %v, want nil — %s is deliberately optional", err, field)
			}
		})
	}
}
