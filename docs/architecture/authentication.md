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

1. `GET /auth/strava` — generates CSRF state token, redirects to Strava authorize URL
2. `GET /auth/callback` — validates state, exchanges code for tokens, checks Firestore allowlist, creates Firebase custom token, redirects to frontend

Auth middleware (`middleware/auth.go`):

1. Validates JWT using Firebase Admin SDK
2. Injects `token.UID` (Strava athlete ID) into request context
3. Returns 401 for invalid/missing token

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
- CSRF protection via signed state token (HMAC-SHA256, 5 min expiry)
- Custom token delivered via URL fragment (never sent to server in logs or Referer headers)
- Firestore allowlist checked server-side during OAuth callback
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

- Uses Firebase Emulator Suite (Auth + Firestore)
- Run `just start-frontend` to start emulators + API Gateway
- For testing the OAuth flow end-to-end, use a tunnel (ngrok/cloudflared) or the deployed dev API
- For day-to-day development, the dev bypass endpoint skips the Strava redirect and issues a custom token directly

See `docs/guides/frontend-local-dev.md` for detailed setup instructions.

## Key Files

| Component | File |
|-----------|------|
| OAuth handler | `packages/apigateway/internal/auth/handler.go` |
| Auth middleware | `packages/apigateway/middleware/auth.go` |
| Strava OAuth client | `packages/apigateway/adapters/strava/oauth.go` |
| Firestore auth store | `packages/apigateway/adapters/firestore/auth_store.go` |
| Firebase init | `packages/web/src/lib/firebase.ts` |
| Auth service | `packages/web/src/services/auth/FirebaseAuthService.ts` |
| Auth context | `packages/web/src/contexts/AuthContext.tsx` |
| Auth complete route | `packages/web/src/routes/auth/complete.tsx` |
| Auth error route | `packages/web/src/routes/auth/error.tsx` |
| API client | `packages/web/src/api/client.ts` |
| User config | `packages/web/src/services/userConfigService.ts` |
| Firestore rules | `firestore.rules` |
| Terraform config | `terraform/modules/desirelines/cloud_run.tf` |
