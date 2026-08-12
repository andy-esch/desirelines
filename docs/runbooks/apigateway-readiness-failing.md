# Alert: apigateway /api/ready failing

**Symptom**: 3 consecutive hourly readiness probes against `/api/ready` have
failed in the last 4 hours. Fires as HIGH to email + Slack. Readiness (unlike
health) checks dependencies, so this usually means Postgres is unreachable.

**First place to look**:

- Neon dashboard — is the compute suspended or down?
- Cloud Logging filter:

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-apigateway"
  jsonPayload.event="readiness_db_unhealthy"
  ```

  The app emits this once per probe, and only after its internal retry is
  exhausted. Each occurrence is already a genuine failure — recovered cold-start
  retries are excluded by construction, and the metric counts the event rather
  than the Scheduler HTTP status.

**Likely causes** (ranked):

1. Neon (Postgres) is down or the compute is suspended.
2. Connection pool misconfiguration.
3. A bug in the readiness handler itself.

**Quick mitigations**:

- Check Neon first — a suspended compute is the common case.
- Trigger the authenticated job with
  `gcloud scheduler jobs run desirelines-<environment>-apigateway-readiness --location=<region> --project=<project-id>`,
  then inspect the job result and API Gateway logs. A direct unauthenticated
  `curl` should return `401` and deliberately does not test PostgreSQL.

**If still stuck**: cross-check `python-readiness-failing.md`. Concurrent
failures across apigateway and postgres-writer indicate a shared Neon outage
rather than a service bug. If health passes but readiness fails, the process is
fine and the dependency is not — see `apigateway-uptime-failing.md`.
