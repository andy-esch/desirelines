# Operations Reference

What's running where, how to reach it, and the procedures that aren't obvious
when you come back to this project after a month away.

For alert response, start at [`docs/runbooks/README.md`](../runbooks/README.md).

> This is a public repo. Project IDs, dashboard IDs, notification channel IDs,
> and secret paths are deliberately absent — navigate by path, not by URL.

## Services

All run on Cloud Run. Console → Cloud Run → the service name.

| Service | Does |
|---|---|
| `desirelines-apigateway` | Go HTTP API. Serves `/v1/*` to the frontend. |
| `desirelines-dispatcher` | Go webhook receiver. Takes Strava `POST /webhook`, publishes to Pub/Sub. |
| `desirelines-postgres-writer` | Python. Consumes activity events, writes Postgres. |
| `desirelines-deletion-service` | Python. Handles activity/user deletion. |

## Public endpoints

The frontend is Firebase Hosting; the API is reached through a Hosting rewrite
(`/api/*` → apigateway Cloud Run).

- `https://<hosting-domain>/` — frontend
- `https://<hosting-domain>/api/health` — liveness (process up)
- `https://<hosting-domain>/api/ready` — readiness (dependencies reachable)
- `https://<hosting-domain>/api/v1/...` — application API

Health vs readiness matters during triage: health passing while readiness fails
means the process is fine and a dependency is not.

## Pub/Sub

Topics and subscriptions per service, each dead-lettering to its own
`*-dlq` topic with a matching `*-dlq-monitoring` pull subscription for
inspection. Console → Pub/Sub → Topics / Subscriptions.

The DLQs are the ones that page — see the DLQ runbooks. There is currently **no
automated redrive path**; draining a DLQ is a manual pull-and-republish.

## Logs

Console → Logging → Logs Explorer. Useful filters:

```
# One service, errors only
resource.type="cloud_run_revision"
resource.labels.service_name="desirelines-dispatcher"
severity>=ERROR
```

```
# Follow one request end-to-end
resource.type="cloud_run_revision"
jsonPayload.correlation_id="<id>"
```

```
# Everything in one trace
resource.type="cloud_run_revision"
trace="projects/${GCP_PROJECT}/traces/<trace-id>"
```

See [`docs/runbooks/reading-traces.md`](../runbooks/reading-traces.md) for
interpreting what you find.

## Dashboard

Console → Monitoring → Dashboards → the Desirelines observability dashboard.

## External services

- **Strava developer console** — <https://www.strava.com/settings/api>
- **Strava status** — <https://status.strava.com>
- **Google Cloud status** — <https://status.cloud.google.com>
- **Neon** — log in, pick the project matching `${ENV}`. Watch for suspended
  compute; it explains most readiness and query-latency alerts.
- **Infisical** — secrets source of truth; syncs to GCP Secret Manager, which
  mounts into services. Navigate from the Infisical dashboard.

## Common procedures

### Verify the Strava webhook subscription

Strava will silently stop delivering if the subscription is gone. Query
Strava's `/push_subscriptions` endpoint with the app's client credentials and
confirm the `callback_url` still points at the dispatcher. Setup and re-creation
steps: [`docs/guides/strava-webhook.md`](strava-webhook.md).

### Force an OAuth token refresh

When an athlete's tokens are stale or missing (see
[`webhook-owner-check-orphan.md`](../runbooks/webhook-owner-check-orphan.md)),
there is no admin-side refresh — refresh tokens are held per-athlete in
Firestore and only the athlete can mint new ones.

1. Confirm the token document is actually missing or stale (Firestore →
   `users/{athleteID}/private/strava_tokens`).
2. Have the athlete re-authorize through the app's sign-in-with-Strava flow.
   This writes fresh tokens.
3. Webhooks resume on their next activity; already-acked events are not
   redelivered by Strava.

Note that a Strava OAuth grant survives a rejected callback — only an explicit
user revoke or a deauthorization call actually drains it.

### Cut a new Terraform module tag

Module changes ship via a `tf-*` tag that the deploy repo pins. Look at the
recent `tf-*` tags for the current numbering, and at the deploy repo's pin for
what consumes it.

### Trigger a test alert

Console → Monitoring → Alerting → pick a policy → **Test notification**. Confirms
the notification channels are live without waiting for a real incident.

## Related

- [`docs/runbooks/README.md`](../runbooks/README.md) — alert index
- [`docs/slo.md`](../slo.md) — SLO definitions and error budgets
- [`docs/architecture/sitemap.md`](../architecture/sitemap.md) — architecture
  view; this page is the operations view
