// Package stravatoken provides shared types and Firestore path constants
// for Strava OAuth token storage. Both apigateway and dispatcher depend on
// this package to keep their Firestore access in sync.
package stravatoken

import (
	"errors"
	"fmt"
	"time"
)

// Firestore collection and document path components.
// Both apigateway and dispatcher use these to build document references.
const (
	UsersCollection     = "users"
	PrivateCollection   = "private"
	TokensDocument      = "strava_tokens" //nolint:gosec // Document name, not credential
	ProfileDocument     = "profile"
	AllowlistCollection = "allowlist"
)

// Data is the Firestore document schema for per-user Strava tokens.
// Stored at users/{athleteID}/private/strava_tokens.
type Data struct {
	AccessToken   string    `firestore:"access_token"`
	RefreshToken  string    `firestore:"refresh_token"`
	ExpiresAt     int64     `firestore:"expires_at"`
	Scopes        string    `firestore:"scopes"`
	ConnectedAt   time.Time `firestore:"connected_at"`
	LastRefreshed time.Time `firestore:"last_refreshed"`
}

// ErrIncompleteTokens indicates a stored token document is missing a field the
// caller cannot function without.
var ErrIncompleteTokens = errors.New("incomplete strava_tokens document")

// Validate rejects a token document that cannot be used to talk to Strava.
//
// Firestore's decoder leaves absent fields at their zero value rather than
// erroring, so a producer that stopped writing refresh_token would hand every
// Go reader an empty string and fail later, somewhere unrelated, as a confusing
// auth error. The Python reader already fails loudly on a missing key
// (TokenData.from_doc indexes rather than .get()s); this brings Go into line so
// the same corrupt document is rejected on both edges.
//
// Deliberately NOT required:
//
//   - scopes — legitimately absent. It is written once by apigateway from the
//     OAuth exchange, and Strava's POST /oauth/token response does not reliably
//     include it (see internal/auth/handler.go validateScope). Webhooks never
//     carry scopes at all, so nothing downstream can repair it. Python treats it
//     as optional too, via .get("scopes", "").
//   - connected_at, last_refreshed — a zero last_refreshed is a real state,
//     meaning "connected but never refreshed since", and neither field gates an
//     API call.
func (d *Data) Validate() error {
	var missing []string
	if d.AccessToken == "" {
		missing = append(missing, "access_token")
	}
	if d.RefreshToken == "" {
		missing = append(missing, "refresh_token")
	}
	if d.ExpiresAt == 0 {
		missing = append(missing, "expires_at")
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: missing %v", ErrIncompleteTokens, missing)
	}
	return nil
}
