# Alert: apigateway /api/health uptime failing

**Symptom**: the apigateway `/api/health` uptime check is failing across
multiple probe regions. Fires as CRITICAL to email + Slack.

Detection lag: the underlying probe runs every 15 minutes, so an outage may not
surface for up to ~17 minutes. This alert is not a fast detector by design.

**First place to look**:

- Console → Monitoring → Uptime checks → the apigateway check, for per-region
  results.
- Console → Cloud Run → `desirelines-apigateway` → **Revisions** — did the
  latest revision fail to start?
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. Cloud Run revision crashed or failed to start.
2. Firebase Hosting rewrite (`/api/*` → Cloud Run) misconfigured.
3. DNS or SSL issue on the hosting site.

**Quick mitigations**:

- If a recent deploy correlates, roll back the revision first and diagnose after.
- Verify the Firebase Hosting rewrite rules still point at the right service.

**If still stuck**: check whether `frontend-uptime-failing.md` is also firing.
Both failing together points at Firebase Hosting or DNS rather than the service;
apigateway alone points at Cloud Run. If health passes but readiness fails, see
`apigateway-readiness-failing.md` — that is a dependency problem, not a process
problem.
