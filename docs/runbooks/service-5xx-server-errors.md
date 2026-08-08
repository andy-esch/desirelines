# Alert: Cloud Run 5xx errors on non-SLO services

**Symptom**: one of the non-SLO Cloud Run services is returning 5xx on >2% of
its requests. Fires as CRITICAL to email + Slack.

Monitored services: `desirelines-postgres-writer`,
`desirelines-deletion-service`.

apigateway and dispatcher 5xx are deliberately excluded here — they are covered
by the SLO 1 and SLO 4 burn-rate alerts.

**First place to look**:

- The alert's `service_name` label names the failing service.
- Cloud Logging filter (substitute the service):

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-<service>"
  severity>=ERROR
  ```

**Likely causes** (ranked):

1. A recent deploy or config change to that service.
2. A failing dependency — BigQuery, Postgres (Neon), or Firestore.
3. Resource limits — OOM kills or instance caps under load.

**Quick mitigations**:

- Check the revision history: if 5xx started at a deploy, roll back first and
  diagnose after.
- Verify the dependency the service actually needs is healthy.

**If still stuck**: for postgres-writer and deletion-service, cross-reference the
matching DLQ runbook (`dlq-postgres-writer.md` / `dlq-deletion-service.md`) —
failures here typically land in the DLQ, so the DLQ payloads give you the
concrete failing message.
