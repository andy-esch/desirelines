# 02. Auth & OAuth Flow Hardening

> **Goal:** Close the small but real gaps in the OAuth state token, scope parsing, token lifecycle, and rate limiting. Each one individually is minor; together they're the difference between an auth flow that survives Strava API changes and one that breaks silently.

## Why it matters

Auth bugs are the worst kind for a personal-use app: **you can't log in to fix them.** The current implementation is solid (signed state tokens, allowlist enforcement, distinct emulator path for dev), but a handful of small choices make it more fragile than it needs to be.

The single most important improvement is fixing the scope parser — Strava's OAuth response uses comma-separated scopes today, but the OAuth2 spec says space-separated, and a server-side change there would lock you out of your own app with an "insufficient_scope" error you couldn't debug from the client.

## Current state

- `internal/auth/state.go:12` — `stateExpiry = 5 * time.Minute`. Tight on slow networks.
- `internal/auth/state.go:14–36` — state token includes a random nonce but is **not bound to the initiating session**. Mitigated by allowlist, but a weak link.
- `internal/auth/handler.go:265–284` — `validateScope` does `strings.Split(grantedScope, ",")`. OAuth2 spec ([RFC 6749 §3.3](https://datatracker.ietf.org/doc/html/rfc6749#section-3.3)) defines scope as **space-separated**. Strava currently returns commas; if Strava ever fixes that, every login fails.
- `internal/auth/handler.go:213–219` — Firebase custom token issued with default 1-hour expiry. Frontend has no documented refresh path.
- `internal/server/router.go:73–75` — `/auth/callback` is rate-limited at the global rate (10 req/s). Reasonable but could be tighter for an endpoint that triggers Firestore lookups + Firebase writes.
- `internal/auth/handler.go:282` — logs `grantedScope` raw on failure. Public string, but easy to make a future leak by reflex.
- `internal/auth/handler.go:156–162` — athlete ID validated `> 0` but no upper bound or pattern check.

## Concrete steps

### 1. Fix scope parsing to be spec-compliant

In `internal/auth/handler.go:276`, replace:

```go
scopes := strings.Split(grantedScope, ",")
```

with:

```go
scopes := strings.FieldsFunc(grantedScope, func(r rune) bool {
    return r == ',' || unicode.IsSpace(r)
})
```

Add a table-driven test covering `"activity:read_all,activity:write"`, `"activity:read_all activity:write"`, `"activity:read_all, activity:write"`, and the Strava-actual format. This is **15 minutes of work** and removes a real future-breakage risk.

### 2. Bind state token to a session cookie

The state token currently proves "I came from this server" but not "I'm the same browser that started the flow." Strengthen it:

- On `/auth/strava` initiation, set a short-lived `__Host-auth_session` cookie (HttpOnly, Secure, SameSite=Lax) with a random ID.
- Include that session ID in the JWT state claims.
- On `/auth/callback`, require the cookie to match the claim.

This blocks the (unlikely-but-real) attack where an intercepted state token is replayed by a different browser. It also lets you stop relying on the allowlist for CSRF protection — defense in depth.

### 3. Extend state token expiry to 15 minutes

`internal/auth/state.go:12` — change `5 * time.Minute` to `15 * time.Minute`. CSRF protection doesn't weaken meaningfully (still single-use, signed, session-bound after step 2), but slow-network users stop getting kicked.

### 4. Document and implement Firebase token refresh

Two parts:

- **Backend:** in the redirect response after callback, include `expiresIn` (default 3600) in the URL fragment so the frontend knows when to refresh.
- **Frontend (cross-package change in `packages/web`):** use the Firebase JS SDK's `onIdTokenChanged` and `getIdToken(true)` patterns to refresh proactively at the 50-minute mark.

Document in `docs/architecture/authentication.md` with a sequence diagram. This is the single most likely production bug as users start leaving the app open in a tab.

### 5. Tighter rate limiting on `/auth/*`

Add a route-scoped rate limiter in `internal/server/router.go` for the `/auth` subtree: 10 requests per minute per IP (vs. global 10 req/s). The OAuth callback is the most expensive endpoint per call (Strava API call + Firestore write + Firebase custom-token mint) and should be the most rate-limited.

If you adopt the per-IP-per-route pattern, factor out a small middleware in `internal/server/middleware.go` so future expensive endpoints can opt in.

### 6. Validate athlete ID range and shape

In `internal/auth/handler.go:156`, add:

```go
if tokenResp.Athlete.ID <= 0 || tokenResp.Athlete.ID > 100_000_000_000 {
    return nil, fmt.Errorf("athlete ID out of expected range: %d", tokenResp.Athlete.ID)
}
```

Strava IDs are 7–11 digits today. The bound is generous. This is a belt-and-suspenders defense against a future Strava API change that returns a sentinel like -1 or 0.

### 7. Stop logging raw scope strings

`internal/auth/handler.go:282` — replace with structured fields:

```go
h.logger.Warn("insufficient scope",
    "has_activity_read_all", hasActivityReadAll,
    "scope_count", len(scopes),
)
```

The raw scope string isn't sensitive today, but making "we never log auth-server response bodies" a rule means you don't have to re-evaluate per field.

## What to skip

- **Don't** rotate `AUTH_STATE_SECRET` automatically. With a session cookie binding (step 2), rotation can be a manual operation when needed.
- **Don't** add a refresh-token endpoint at the apigateway. Firebase's SDK handles ID-token refresh client-side; the Strava refresh token is server-side only and used by stravapipe.
- **Don't** add MFA. Single-user app behind an allowlist; not worth the complexity.

## References

- RFC 6749 §3.3 (OAuth 2.0 scope syntax — space-separated): https://datatracker.ietf.org/doc/html/rfc6749#section-3.3
- Strava OAuth docs: https://developers.strava.com/docs/authentication/
- OWASP CSRF prevention cheat sheet (state-token + session binding): https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP `__Host-` cookie prefix guidance: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookie-prefixes
- Firebase ID token refresh (`onIdTokenChanged`): https://firebase.google.com/docs/auth/admin/manage-sessions
- chi sub-router middleware pattern: https://github.com/go-chi/chi#middlewares
