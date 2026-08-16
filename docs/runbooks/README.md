# Alert Runbooks

When a Desirelines alert fires (email + Slack), find the matching runbook below.
Severity buckets match the `**SEVERITY**` prefix in each alert's
`documentation.content`.

Each runbook follows the same shape: **Symptom** (what fired), **First place to
look**, **Likely causes** (ranked), **Quick mitigations**, **If still stuck**.

## Critical

- [DLQ: PostgreSQL Writer has messages](dlq-postgres-writer.md)
- [DLQ: Deletion Service has messages](dlq-deletion-service.md)
- [DLQ: Activity Rows (BigQuery CDC) has messages](dlq-activity-rows.md)
- [Cloud Run 5xx errors on non-SLO services](service-5xx-server-errors.md)
- [apigateway /api/health uptime failing](apigateway-uptime-failing.md)
- [frontend root uptime failing](frontend-uptime-failing.md)
- [No Strava webhook events received in 24h](webhook-events-absent.md)

## High

- [Pub/Sub old unacked messages](pubsub-old-unacked-messages.md)
- [apigateway /api/ready failing](apigateway-readiness-failing.md)
- [Python service /ready failing](python-readiness-failing.md)
- [Postgres connection pool near exhaustion](postgres-pool-exhaustion.md)
- [apigateway 401/403 surge (credential attack)](apigateway-auth-failure-surge.md)
- [apigateway 429 surge (rate-limit engagement)](apigateway-rate-limited-surge.md)
- [dispatcher 400 surge (webhook tampering)](dispatcher-bad-request-surge.md)
- [Webhook for allowlisted athlete with no tokens (orphan)](webhook-owner-check-orphan.md)
- [Strava sport_type with no registry mapping](unknown-sport-type-detected.md)

## Medium

- [apigateway 404 surge (scanner activity)](apigateway-not-found-surge.md)
- [Strava API P99 latency high](strava-api-latency.md)
- [HTTP request P99 latency high](http-request-latency.md)
- [Postgres query P99 latency high](postgres-query-latency.md)
- [Firestore operation P99 latency high](firestore-operation-latency.md)
- [Pub/Sub publish P99 latency high](pubsub-publish-latency.md)
- [Allowlist read errors elevated](webhook-owner-check-error.md)
- [Activity-row publish failing](activity-row-publish-failing.md)

## SLO burn-rate

Each SLO has a fast-burn (1h) and a slow-burn (6h) alert. Both share one runbook
— the remediation is the same; only the urgency differs.

- [SLO 1 — dispatcher availability](slo-1-dispatcher-availability.md)
- [SLO 2 — webhook ingest success](slo-2-webhook-ingest-success.md)
- [SLO 4 — apigateway availability](slo-4-apigateway-availability.md)
- [SLO 5 — apigateway latency](slo-5-apigateway-latency.md)

SLO specs live in [`docs/slo.md`](../slo.md).

## Techniques

- [Reading traces](reading-traces.md) — trace inspection and the slow-pattern
  table. Not an alert; referenced by several runbooks above.
- [Redriving a DLQ](dlq-redrive.md) — replaying dead-lettered messages onto
  their source topic. Referenced by the three DLQ runbooks.

## Operations

- [Operations reference](../guides/operations.md) — what's running where, how to
  reach it, common procedures.

---

**Adding a new alert?** Write a runbook in this format, add it to the right
bucket above, and put a `**Runbook**: docs/runbooks/<slug>.md` line at the top
of the alert's `documentation.content` so the notification links here.
