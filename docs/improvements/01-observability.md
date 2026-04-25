# 01. Lightweight Observability

> **Goal:** Find out something is broken before a user does, and have enough context to fix it without re-deriving the system from first principles.

This is intentionally **not** an SRE program. No SLOs, no error budgets, no on-call rotation. For a personal project the right shape is: a handful of alerts that email you, one dashboard you can pull up on your phone, and a short page of "if X breaks, look here" notes.

## Why it matters

Desirelines is a webhook-driven distributed system: `dispatcher → Pub/Sub → bq-inserter + postgres-writer → apigateway → web`. Failure modes are non-obvious — a stuck Pub/Sub subscription, an expired Strava OAuth token, a Firestore timeout — and you usually don't notice until you open the app and the chart hasn't updated for a week. The fix is cheap: GCP already collects most of what you need, you just need to point a few alert policies at it and write down what to do when they fire.

## Current state

- Structured JSON logging in Go via `packages/shared/gcplog`.
- OTel metrics + traces wired in `packages/shared/otel` and the chi middleware.
- Python services have conditional OTel exporters and `setup_logging()` for Cloud Logging.
- **No alert policies, no dashboards, no runbook anywhere in `terraform/` or `docs/`.**
- No request-ID propagation through the Pub/Sub chain — only W3C trace context.
- Health endpoints exist (`/health`) but nothing pings them.

## Concrete steps

Each step is small enough to land in one sitting.

### 1. Add three alerts in Terraform

Create `terraform/modules/alerts/main.tf` with `google_monitoring_alert_policy` resources and a single `notification_channel` (your email). Start with three:

- **Webhook ingest is failing** — `dispatcher` 5xx rate > 5% over 10 min, or `webhook_events_total` drops to 0 for an hour during normal usage hours.
- **Pipeline is stuck** — Pub/Sub subscription `oldest_unacked_message_age` > 10 minutes for either `bq-inserter` or `postgres-writer` subscription.
- **API is down** — synthetic uptime check on `apigateway`'s `/health` failing for 5 min.

Skip "warning" tier. Either it's worth an email or it isn't.

### 2. Add an uptime check

`google_monitoring_uptime_check_config` against `apigateway` `/health` every 5 minutes. Wire it into the alert above. ~10 lines of HCL.

### 3. Commit one dashboard as JSON

Cloud Monitoring → build a dashboard with five tiles: dispatcher request rate + p95, dispatcher 5xx rate, Pub/Sub unacked age per subscription, Postgres connections, apigateway p95. Export to JSON, save under `observability/dashboards/main.json`. Reapply via `google_monitoring_dashboard` so it survives project rebuilds.

### 4. Write `docs/runbooks/README.md` with one page per alert

Format for each:

```markdown
## Alert: <name>

**Symptom:** what fires, where it appears.
**First place to look:** specific Cloud Logging query or dashboard URL.
**Likely causes:** ranked list, top 3.
**Quick mitigations:** commands you'd actually run.
**If still stuck:** which logs/services to dig into.
```

Keep each runbook under one screen. Link them from each alert's `documentation.content` field so the email contains the URL.

### 5. Propagate a request ID through the pipeline

- Add `X-Request-ID` middleware to `apigateway` and `dispatcher` (generate UUIDv7 if missing, echo back in response).
- When `dispatcher` publishes to Pub/Sub, attach the request ID as a message attribute.
- In `stravapipe` consumers, read the attribute and bind it to the `slog`/Python logger as `request_id`.

This is the single biggest debugging lift you'll get for one afternoon of work — a user sends you a screenshot, you grep the logs once.

### 6. Add a "what's running where" page

Single doc, `docs/operations.md`:

- Service URLs (production + staging if separate).
- Cloud Run service names, Pub/Sub topic + subscription names.
- Where logs live (links to filtered Cloud Logging queries).
- Where the dashboard lives.
- Strava developer console URL.
- The OAuth token-refresh procedure if you're locked out.

Future-you will thank present-you the first time you context-switch back to this after a month away.

## What to skip

- **Don't** define SLOs or error budgets. Premature for a personal project; the formality outweighs the value.
- **Don't** set up PagerDuty/OpsGenie. Email is fine.
- **Don't** instrument every function. The OTel auto-instrumentation in chi already gives you per-route latencies; that's enough until you're chasing a specific bug.
- **Don't** build a custom metrics pipeline. Cloud Monitoring is free up to generous limits and you're already in GCP.

## References

- Cloud Monitoring alert policies (Terraform): https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy
- Cloud Monitoring uptime checks: https://cloud.google.com/monitoring/uptime-checks
- Pub/Sub monitoring metrics (look for `oldest_unacked_message_age`): https://cloud.google.com/pubsub/docs/monitoring
- OpenTelemetry baggage / context propagation: https://opentelemetry.io/docs/concepts/signals/baggage/
- "Production-Ready Microservices" (Susan Fowler) — Ch. 6 covers proportionate monitoring for small systems. ISBN 978-1491965979.
