# Alert: apigateway 401/403 surge (credential attack)

**Symptom**: apigateway returning 401 or 403 at >10/min sustained for 5
minutes. Fires as HIGH to email + Slack. Most likely an external actor probing
authenticated endpoints — credential stuffing, OAuth code injection on the
`/auth/callback` path, or stale-token replay.

**First place to look**:

- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  httpRequest.status=401 OR httpRequest.status=403
  ```

- The request paths matter: `/auth/*` vs `/v1/*` distinguishes an OAuth attack
  from an authenticated-endpoint probe.

**Likely causes** (ranked):

1. External actor probing authenticated endpoints (credential stuffing).
2. OAuth code injection attempts against `/auth/callback`.
3. Stale-token replay — expired tokens being retried in bulk.
4. Benign: a burst around token-expiry events. The 5-minute duration filter
   should already absorb these; a single brief spike is not actionable.

**Quick mitigations**:

- Inspect source IPs and user agents. A single IP hammering can be blocked at
  Firebase Hosting or Cloud Armor. Many IPs means a distributed scanner.
- If concentrated on `/auth/callback`: review the recent OAuth flow — was a
  Strava code leaked, did a redirect URI change?

**If still stuck**: cross-reference `apigateway-rate-limited-surge.md` — a
credential attack usually trips the rate limiter too, and 429s firing alongside
means the limiter is absorbing it.
