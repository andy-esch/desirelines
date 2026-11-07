# Authentication Architecture

## Overview

Strava OAuth with Firebase Custom Auth protects personal activity data. Users sign in with their Strava account; the API gateway exchanges the OAuth code for a Firebase custom token. Access is controlled by a Firestore app UID allowlist. Unauthenticated users see client-side generated demo data.

## Auth Flow

```
User → "Connect with Strava" → API Gateway /auth/strava → Strava OAuth
     → /auth/callback → Connection registry → App admission → Firebase Custom Token
     → Frontend /auth/complete → signInWithCustomToken → Session established
```

**Frontend** (`packages/web/`):

1. User clicks "Connect with Strava" → redirect to `{API_GATEWAY_URL}/auth/strava`
2. After Strava approval, gateway redirects to `/auth/complete#token={custom_token}`
3. `/auth/complete` route reads token from URL fragment, calls `signInWithCustomToken()`
4. Firebase issues JWT ID token (1 hour validity, auto-refreshed)
5. Token sent in `Authorization: Bearer <token>` header via Axios interceptor
6. On auth error: redirect to `/auth/error` with error code

**Backend** (`packages/apigateway/`):

OAuth endpoints (`internal/auth/`):

1. `GET /auth/strava` — redirects to `/auth/strava/start` on the configured
   callback origin, canonicalizing Firebase Hosting aliases before any cookie is
   minted.
2. `GET /auth/strava/start` — generates a signed CSRF state token, binds it to
   the browser in the Firebase Hosting-reserved `__session` cookie, and redirects
   to `StravaOAuthClient.AuthorizeURL()` (Strava in production, gateway's own
   callback in local dev).
3. `GET /auth/callback` — validates state and the browser-bound cookie,
   exchanges the code via `StravaOAuthClient.ExchangeCode()`, resolves the Strava
   subject through the active registry pair, and checks the resolved app UID
   against the allowlist. Credential/profile writes recheck that exact UID/subject
   pair and admission inside their transaction. Firebase profile sync and custom
   token creation use the resolved UID after commit.

Auth middleware (`middleware/auth.go`):

1. Validates JWT using Firebase Admin SDK.
2. Re-checks the app UID allowlist, using a short positive-only cache to
   coalesce map-tile bursts while bounding revocation staleness.
3. Injects the app UID from `token.UID` into request context.
4. Returns 401 for invalid identity, 403 for removal, or 503 when authorization
   cannot be checked.

**Identity model**: the Firebase UID identifies app data and PostgreSQL `user_id`.
The registry maps a Strava subject to that UID; existing users retain their
numeric UIDs. The callback never derives a UID from an athlete ID or falls back
when ownership is absent, inactive or inconsistent. Activity persistence and
full-deletion consumers remain on the legacy numeric model until their routing stages.

**User States**:

| State | Result |
|-------|--------|
| Not signed in | Client-side generated demo data (no API calls) |
| Signed in (on allowlist) | Real data from PostgreSQL via API Gateway |
| Not on allowlist | Redirect to `/auth/error?error=not_invited` |
| OAuth denied | Redirect to `/auth/error?error=access_denied` |

## Security Properties

**Secure**:

- Server-side JWT validation (Firebase Admin SDK)
- OAuth callback CSRF protection via an expiring signed state token (exact HS256)
  bound to a Secure, HttpOnly, SameSite=Lax, host-only `__session` cookie
- Custom token delivered via URL fragment (never sent to server in logs or Referer headers)
- Firestore allowlist checked during OAuth callback and protected API requests
- `Cache-Control: private, no-store` on authenticated responses

**Access control**:

- Firestore `allowlist/{uid}` — must exist for OAuth to succeed
- Managed via Admin SDK (not client-accessible)
- Strava tokens at `users/{uid}/private/strava_tokens` are denied to client SDKs
  by [Firestore rules](../../firestore.rules). Profile metadata is owner-readable
  and server-writable. Legacy profile/token fields were previously client-writable;
  the [registry bootstrap](../guides/activity-connection-registry.md) never uses
  them to establish ownership.

## Firestore User Config

User settings (preferences, goals, annotations) stored in Firestore at `users/{userId}/config/v1`.

**Security rules**: [firestore.rules](../../firestore.rules) owns the executable
policy. Config reads/deletes require the matching Firebase UID; creates/updates
also require `schemaVersion`, `userId` and `lastUpdated`, with a matching `userId`.
Profile reads and config access still use owner UID without an admission check.
API allowlist checks do not restrict direct Firestore access; independent sign-in
must remain disabled until admission-aware rules are implemented and verified.

The gateway requires verified, sealed bootstrap evidence through
[`identity-rollout.json`](../../scripts/ci/identity-rollout.json). New independent
enrollment remains disabled. Missing/inactive ownership or removed admission
returns `not_invited`; conflicting ownership or backend failures return
`server_error`. Retry OAuth after transient failures; an in-flight grant is never
retargeted to a newly resolved UID. OAuth exchanges and Firebase Auth calls stay
outside Firestore transaction retries. Rollback must retain registry-aware
admission/deletion and the current reviewed rules; never remove sealed mappings.
See the [registry contract and rollout](../guides/activity-connection-registry.md).

**Webhook ownership**: the [dispatcher](../../packages/dispatcher/README.md#architecture)
resolves the provider subject before app UID admission and credential access. Its
cache rechecks ownership on hits; refresh/deletion transactions retain the captured
UID/subject pair across retries. Missing/conflicting mappings remain retryable
errors, distinct from missing credential documents. Deauthorization confirms the
grant, publishes durable cleanup, then best-effort deletes bound credentials,
without requiring app admission. Event payloads retain Strava IDs; persistence and
full-deletion routing remain separate stages. Python
[backfill credentials](../../packages/stravapipe/src/stravapipe/adapters/firestore/token_store.py)
now use the resolved UID and conditional rotation writes, with external OAuth
outside transactions. Backfill rejects UID/subject pairs that differ until its
activity persistence is migrated.

**Whose config**: the web client holds one session's config in one store
(`UserConfigProvider`), with one cache entry for the whole document and one listener.
Components read and save it through the section hooks (`usePreferences`, `useGoals`,
`useAnnotations`, `useAllGoals`); a scan test
(`packages/web/src/services/config/storeBoundary.test.ts`) keeps every other module from
reaching Firestore or the demo's storage around it.

- Signed in: the document at `users/{uid}/config/v1`, the uid being the Firebase UID
  (retained numeric IDs for legacy accounts).
- Signed out: the demo's own storage on the device, under `demo.` keys in localStorage.
  It never reads the account's document, and the account never reads it.

## Local Development

**Demo Mode** (recommended for UI work):

- No backend required — data generated client-side
- Just run `npm run dev` in `packages/web/`

**Authenticated Mode** (for testing auth flows):

- Run `just start-frontend` to start Firebase emulators + API Gateway + PostgreSQL
- Uses Firebase Auth Emulator for real JWT minting/verification
- A mock Strava adapter (`MockOAuthClient`) replaces the real Strava OAuth redirect — clicking "Connect with Strava" instantly completes the OAuth flow via the gateway's own callback URL
- A mock auth store discards credential writes; local admission always allows. An
  explicit connection fixture resolves only the configured `MOCK_ATHLETE_ID`.
- The full auth middleware runs on every request, verifying real Firebase JWTs against the emulator — identical to production
- Firebase Emulator UI available at `http://localhost:4000`

```
Local dev flow:
1. User clicks "Connect with Strava"
2. HandleInitiate redirects to gateway's own callback (mock AuthorizeURL includes code=mock-dev-code)
3. HandleCallback validates state JWT, calls MockOAuthClient.ExchangeCode → hardcoded athlete
4. MockAuthStore.IsAllowed → true, WriteAuthData → no-op
5. Firebase Admin SDK mints custom token against Auth emulator
6. Frontend signInWithCustomToken() against Auth emulator → real session
7. All API calls carry real Firebase ID tokens, verified by real auth middleware
```

See `docs/guides/frontend-local-dev.md` for detailed setup instructions.

## Key Files

| Component | File |
|-----------|------|
| OAuth handler | `packages/apigateway/internal/auth/handler.go` |
| Auth interfaces | `packages/apigateway/internal/auth/interfaces.go` |
| Auth middleware | `packages/apigateway/middleware/auth.go` |
| Strava OAuth client | `packages/apigateway/adapters/strava/oauth.go` |
| Mock Strava OAuth | `packages/apigateway/adapters/strava/mock_oauth.go` |
| Firestore auth store | `packages/apigateway/adapters/firestore/auth_store.go` |
| Mock auth store | `packages/apigateway/adapters/mock/auth_store.go` |
| Firebase init | `packages/web/src/lib/firebase.ts` |
| Auth service | `packages/web/src/services/auth/FirebaseAuthService.ts` |
| Auth context | `packages/web/src/contexts/AuthContext.tsx` |
| Auth complete route | `packages/web/src/routes/auth/complete.tsx` |
| Auth error route | `packages/web/src/routes/auth/error.tsx` |
| API client | `packages/web/src/api/client.ts` |
| User config | `packages/web/src/services/userConfigService.ts` |
| User config store | `packages/web/src/contexts/UserConfigProvider.tsx`, `packages/web/src/services/config/` |
| Firestore rules | `firestore.rules` |
| Terraform config | `terraform/modules/desirelines/cloud_run.tf` |
