// Package auth provides HTTP handlers for the Strava OAuth2 authorization code flow.
//
// # Endpoints
//
//   - GET /auth/strava   — Initiates OAuth by redirecting to Strava's authorize page
//   - GET /auth/callback  — Handles the OAuth callback from Strava
//
// These endpoints are public (no auth middleware) because they are part of the
// login flow itself. The callback produces a Firebase custom token that the
// frontend uses for subsequent authenticated requests.
//
// # OAuth Flow
//
// The flow follows the standard OAuth2 authorization code grant:
//
//  1. User visits /auth/strava → redirect to Strava with CSRF state token
//  2. User approves on Strava → Strava redirects to /auth/callback with code
//  3. Callback validates state, exchanges code for Strava tokens
//  4. Checks athlete against Firestore allowlist (invite-only)
//  5. Writes tokens + profile atomically to Firestore via transaction
//  6. Creates Firebase custom token (UID = Strava athlete ID as string)
//  7. Redirects to frontend with token in URL fragment (#token=...)
//
// URL fragments are used for token delivery because fragments are never sent
// to servers, preventing token leakage in server logs, Referer headers, and
// proxy logs. The frontend reads the token via window.location.hash.
//
// # Error Handling
//
// All errors during the browser redirect flow are communicated via redirect
// to {FRONTEND_URL}/auth/error?error={code} rather than JSON responses,
// because the user is in a browser-based OAuth flow. Error codes:
//
//   - access_denied: User denied Strava authorization
//   - invalid_state: CSRF state token invalid or expired
//   - missing_code: No authorization code in callback
//   - exchange_failed: Strava token exchange failed or returned invalid data
//   - not_invited: Athlete not on allowlist
//   - server_error: Internal error (Firestore, Firebase, etc.)
//
// # Architecture
//
// The package follows hexagonal architecture with port interfaces:
//
//   - [StravaOAuthClient]: Exchanges authorization code for tokens
//   - [TokenStore]: Writes tokens and profile to Firestore
//   - [AllowlistChecker]: Checks if athlete is invited
//   - [FirebaseAuthClient]: Creates Firebase custom auth tokens and manages user profiles
//
// All dependencies are injected via [HandlerConfig] and [NewHandler].
// Production adapters live in adapters/strava/ and adapters/firestore/.
//
// # State Tokens
//
// CSRF protection uses signed JWTs (HMAC-SHA256) with 5-minute expiry and
// random nonces. See [generateState] and [validateState] in state.go.
package auth
