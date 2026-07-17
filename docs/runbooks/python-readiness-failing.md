# Alert: Python service /ready failing

**Symptom**: 3 consecutive hourly readiness probes against a Python service's
`/ready` have failed in the last 4 hours. Fires as HIGH to email + Slack. The
alert's `service` label names which service.

**First place to look**:

- Cloud Logging filter (substitute the service from the alert label):

  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="desirelines-<service>"
  jsonPayload.event="readiness_probe_failed"
  ```

  The app emits this once per probe, and only after its internal retry is
  exhausted. Each occurrence is already a genuine failure — recovered cold-start
  retries are excluded by construction, and the metric counts the event rather
  than the Scheduler HTTP status.

**Likely causes** (ranked, by service):

1. **postgres-writer** — Neon down, or pool exhausted.
2. **bq-inserter** — BigQuery permissions drift, or the dataset is missing.
3. **deletion-service** — BigQuery or Firestore credentials expired.

**Quick mitigations**:

- Test the endpoint directly via the scheduler's **Run now** button.
- Check the dependency named above for the specific failing service.

**If still stuck**: cross-check `apigateway-readiness-failing.md`. Concurrent
failures on apigateway and postgres-writer indicate a shared Neon outage rather
than a per-service bug. If a service is failing readiness *and* filling its DLQ,
start from the DLQ runbook — the payloads name the concrete failure.

> When adding a service to the readiness targets, add a bullet above.
