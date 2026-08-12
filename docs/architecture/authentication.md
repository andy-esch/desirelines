# Authentication Architecture

## Overview

Strava OAuth with Firebase Custom Auth protects personal activity data. Users sign in with their Strava account; the API gateway exchanges the OAuth code for a Firebase custom token. Access is controlled by a Firestore athlete ID allowlist. Unauthenticated users see client-side generated demo data.

## Auth Flow

```
User → "Connect with Strava" → API Gateway /auth/strava → Strava OAuth
     → /auth/callback → Firestore allowlist check → Firebase Custom Token
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
   exchanges the code via `StravaOAuthClient.ExchangeCode()`, checks the
   allowlist, creates a Firebase custom token, and redirects to the frontend.

Auth middleware (`middleware/auth.go`):

1. Validates JWT using Firebase Admin SDK.
2. Re-checks the athlete-ID allowlist, using a short positive-only cache to
   coalesce map-tile bursts while bounding revocation staleness.
3. Injects `token.UID` (Strava athlete ID) into request context.
4. Returns 401 for invalid identity, 403 for removal, or 503 when authorization
   cannot be checked.

**Identity model**: Firebase UID = Strava athlete ID (as string) = PostgreSQL `user_id` column.

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
- Login-CSRF protection via a signed state token (exact HS256, 5 min expiry)
  bound to a Secure, HttpOnly, SameSite=Lax, host-only `__session` cookie
- Custom token delivered via URL fragment (never sent to server in logs or Referer headers)
- Firestore allowlist checked during OAuth callback and protected API requests
- `Cache-Control: private, no-store` on authenticated responses
- Strava tokens stored server-side in Firestore (never exposed to frontend)

**Access control**:

- Firestore `allowlist/{strava_athlete_id}` — must exist for OAuth to succeed
- Managed via Admin SDK (not client-accessible)

## Firestore User Config

User settings (goals, annotations) stored in Firestore at `users/{userId}/config/v1`.

**Security Rules** (`firestore.rules` at repo root):

```javascript
match /users/{userId}/config/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

**userId Resolution**:

```typescript
const effectiveUserId = userId ?? user?.uid ?? "default";
```

- Authenticated: Uses Firebase UID (= Strava athlete ID)
- Unauthenticated: Uses `"default"` (demo mode with client-side generated data)

## Local Development

**Demo Mode** (recommended for UI work):

- No backend required — data generated client-side
- Just run `npm run dev` in `packages/web/`

**Authenticated Mode** (for testing auth flows):

- Run `just start-frontend` to start Firebase emulators + API Gateway + PostgreSQL
- Uses Firebase Auth Emulator for real JWT minting/verification
- A mock Strava adapter (`MockOAuthClient`) replaces the real Strava OAuth redirect — clicking "Connect with Strava" instantly completes the OAuth flow via the gateway's own callback URL
- A mock auth store (`MockAuthStore`) replaces Firestore for token storage and allowlist checks (always allows, discards writes)
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
| Firestore rules | `firestore.rules` |
| Terraform config | `terraform/modules/desirelines/cloud_run.tf` |
