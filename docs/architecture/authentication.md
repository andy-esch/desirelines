# Authentication Architecture

## Overview

Firebase Authentication with email-based authorization protects personal Strava data. Only the developer's email is authorized to view real data; all other users see client-side generated demo data.

## Auth Flow

```
User → Firebase Auth (Google OAuth) → JWT Token → API Gateway → Email Allowlist Check
```

**Frontend** (`packages/web/`):
1. User signs in via Google OAuth (Firebase Auth)
2. Firebase issues JWT ID token (1 hour validity, auto-refreshed)
3. Token sent in `Authorization: Bearer <token>` header
4. On 403: Auto sign-out → show demo data

**Backend** (`packages/apigateway/middleware/auth.go`):
1. Validates JWT using Firebase Admin SDK
2. Extracts email from verified token
3. Checks email against `ALLOWED_EMAILS` env var
4. Returns 401 (invalid token) or 403 (unauthorized email)

**User States**:
| State | Result |
|-------|--------|
| Not signed in | Client-side generated demo data (no API calls) |
| Signed in + authorized | Real data from PostgreSQL via API Gateway |
| Signed in + unauthorized | Auto sign-out → demo data |

## Security Properties

**Secure**:
- Server-side JWT validation (Firebase Admin SDK)
- Email extracted from verified token (not user-provided)
- Allowlist in server env var (not in browser)
- `Cache-Control: private, no-store` on authenticated responses

**Limitations**:
- Single-user per environment
- Not multi-tenant (data is per-project, not per-user)

## Firestore User Config

User settings (goals, annotations) stored in Firestore at `users/{userId}/config/v1`.

**Security Rules** (`packages/web/firestore.rules`):
```javascript
match /users/{userId}/config/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

**userId Resolution**:
```typescript
const effectiveUserId = userId ?? user?.uid ?? "default";
```
- Authenticated: Uses Firebase UID
- Unauthenticated: Uses `"default"` (demo mode with client-side generated data)

## Local Development

**Demo Mode** (recommended for UI work):
- No backend required - data generated client-side
- Just run `npm run dev` in `packages/web/`

**Authenticated Mode** (for testing auth flows):
- Uses Firebase Emulator Suite (Auth + Firestore)
- Run `just start-frontend` to start emulators + API Gateway
- Create test users in Emulator UI at http://localhost:4000
- Add test user emails to `ALLOWED_EMAILS` in `.env.local`

See `docs/guides/frontend-local-dev.md` for detailed setup instructions.

## Key Files

| Component | File |
|-----------|------|
| Auth middleware | `packages/apigateway/middleware/auth.go` |
| Firebase init | `packages/web/src/lib/firebase.ts` |
| Auth context | `packages/web/src/contexts/AuthContext.tsx` |
| API client | `packages/web/src/api/activities.ts` |
| User config | `packages/web/src/services/userConfigService.ts` |
| Firestore rules | `packages/web/firestore.rules` |
| Terraform config | `terraform/modules/desirelines/cloud_run.tf`
