# Reading traces in Cloud Trace

Operational companion to [docs/architecture/observability.md](../architecture/observability.md). When a webhook is slow, an alert fires, or a user reports a missing activity, this is how you find the trace and what to look for.

## Find the trace

### From a user-reported error

If the user has an error response, it includes `trace_id` (raw 32-char hex):

```json
{ "error": "...", "code": "...", "trace_id": "32beef1f57fe81b77a21a940a9e90080" }
```

GCP Console → **Trace explorer** → paste the ID into the search bar. Done.

### From a known activity ID

Cloud Trace doesn't index by activity_id directly, but spans carry it as an attribute. Two ways to find the trace:

1. **Logs Explorer** — filter to the relevant service and search for the activity ID:

   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name=~"desirelines-(dispatcher|bq-inserter|postgres-writer)"
   jsonPayload.activity_id="12345678"
   ```

   Click any matching log entry; the entry has a `trace` field. Click the trace icon to jump to Cloud Trace.

2. **Trace explorer with span filter** — use the attribute filter `+attribute:desirelines.activity_id=12345678`. Slower but no log digging required.

   > Note: span attributes are `desirelines.*`-namespaced (e.g.
   > `desirelines.activity_id`, `desirelines.aspect_type`,
   > `desirelines.object_id`), but **log fields stay bare**
   > (`jsonPayload.activity_id`) and **metric labels stay bare**
   > (`metric.labels.aspect_type`). Same value, different name per
   > plane — use the namespaced form only for Trace-explorer attribute
   > filters.

### From an alert

Most alerts include a representative log line in the notification. That log line has a `trace` field; click through to Cloud Trace.

### Fishing expedition (no specific ID)

Trace explorer → filter by service name (`desirelines-dispatcher`, etc.) and the time window. Use **status** facet to surface errors.

## What a healthy webhook trace looks like

End-to-end, you should see a single trace with a span tree like:

```
POST /webhook                                  (dispatcher, otelhttp)
├─ dispatcher.allowlist_check                  ~50ms
│    └─ firestore.DocumentRef.Get
├─ strava.FetchActivity                        ~200-400ms
│    ├─ firestore.GetTokens
│    ├─ HTTP GET (otelhttp transport)
│    └─ strava.RefreshToken    (refresh-ahead near expiry; or reactively on 401)
└─ pubsub.Publish                              ~50ms
     ├─ bq_inserter.webhook.process            (child via traceparent)
     │    └─ bigquery.insert_rows
     │         ├─ bigquery.write_to_staging
     │         ├─ bigquery.merge_from_staging  ← usually the slow one
     │         └─ bigquery.cleanup_staging
     └─ postgres_writer.webhook.process        (child via traceparent)
          └─ postgres.insert
               ├─ postgres.session.acquire
               ├─ postgres.activities.insert
               ├─ postgres.polyline.decode     (CPU; long routes show here)
               ├─ postgres.activities.insert_route
               └─ postgres.commit
```

A typical end-to-end duration is **400-700ms warm, 2-6s on cold start** (Cloud Run cold start + connection-pool warm).

## Reading the trace

### "It's slow — where's the time going?"

Look for the **widest single span** in the timeline view. The pattern is usually one of:

| Wide span | Likely cause | Where to dig |
|---|---|---|
| `bigquery.merge_from_staging` (>1s) | MERGE SQL job throttled or large staging table | Check `bigquery.cleanup_staging` previous-run history; if cleanup has been deferred, staging is bloated |
| `bigquery.cleanup_staging` errored | Streaming buffer DELETE refused (expected) | Look at log line `Staging cleanup deferred`; not a bug, will retry |
| `strava.FetchActivity` (>500ms) | Strava API latency or token refresh | Check for child `strava.RefreshToken` span — if present, this is a one-time hit |
| `postgres.polyline.decode` (>200ms) | Long route activity | Expected for ultras; not actionable unless persistent |
| `postgres.session.acquire` (>200ms) | Pool contention or Neon cold compute | If consistent, check Neon compute hours / pool config |
| `postgres.activities.insert` (~700ms-1.5s) on the **first** webhook after idle | Neon compute wake-up — the first query after the compute scales to zero pays the wake cost (`session.acquire` will be sub-ms because pool checkout is just TCP). Subsequent inserts within the warm window drop to ~150-200ms. | Not a bug. Confirm by uploading a second activity quickly: insert latency should drop 4-5×. |
| Cold-start gap before first span | Cloud Run cold start | Expected on the first request after idle; not a bug |

### "There's a missing parent span"

Cloud Trace flags a span whose `parent_id` doesn't resolve. Four causes, ranked:

1. **Upstream trust-boundary parent (the dispatcher's normal case).** The dispatcher's `POST /webhook` span continues the inbound `X-Cloud-Trace-Context` header by design (see [observability.md](../architecture/observability.md) — trusted callers continue the trace). Cloud Run's edge layer / Strava's webhook system owns the parent span_id and doesn't export to our Cloud Trace project, so Cloud Trace flags it as missing. **This appears on every dispatcher webhook trace and is not a bug.** Apigateway is exempt because of `WithPublicEndpointFn(true)`.

   *To confirm this is the cause:* the missing span_id should equal `POST /webhook`'s `parent_span_id` (visible in the span attributes panel). All other spans in the trace will have visible parents.

2. **Exporter dropout** during cold start — BatchSpanProcessor's queue saturated before it could flush. Acceptable noise.
3. **Sampling decision drift** — N/A while `AlwaysSample` is in effect.
4. **Propagation gap** — the bug case. Signal: a Python service's `webhook.process` has a `parent_span_id` that doesn't match the dispatcher's `pubsub.Publish` span_id. Check Go inject in `packages/dispatcher/adapters/pubsub/publisher.go` and Python extract in `packages/stravapipe/src/stravapipe/shared/tracing.py:extract_context_from_attributes`.

Triage rule: if the missing ID matches `POST /webhook`'s parent, you're in case 1 — done. If a Python `webhook.process` doesn't parent to `pubsub.Publish`, you're in case 4 — bug.

### "Show logs" doesn't work

Cloud Trace's "Show logs" pulls log entries with a matching `trace` field. If logs are missing:

- The log was emitted **outside an active span**. In Python, this means it fired before `record_span()` opened or after it closed. In Go, the request must have an `otelhttp` server span active.
- The OTel `trace_id` doesn't match the log's `trace` field. The composite propagator order in `provider.go` ensures these match — if they don't, something has been changed in the propagator setup.

See [observability.md → Logs ↔ Trace correlation](../architecture/observability.md) for the structural side.

### "Same span name appears twice in one trace"

The webhook flow has two parallel subscribers (bq-inserter, postgres-writer) on the same Pub/Sub event. Their root spans are now **service-prefixed** (`bq_inserter.webhook.process` and `postgres_writer.webhook.process`) so they don't collide visually. If you see two un-prefixed `webhook.process` spans, you're looking at an old trace from before that change shipped — confirm the deploy version against `provider.go` history.

## Pulling a trace by scenario

Useful when investigating "does this code path even work?":

| Scenario | How to reproduce / find |
|---|---|
| Allowlisted user activity (warm) | Upload an activity from a known-allowlisted athlete; pull dispatcher logs |
| Non-allowlisted (stray) | Filter logs `result=stray` on the `owner_check` counter; trace is short — ack 200, no Strava call |
| Strava 404 (deleted before fetch) | Filter logs `"Activity not found in Strava"`; downstream publishes without `raw_activity` |
| DELETE webhook | Filter `aspect_type=delete`; bq-inserter runs `bigquery.archive_insert` + `bigquery.activity_delete` |
| UPDATE webhook | Filter `aspect_type=update`; bq-inserter currently ignores, postgres-writer runs `postgres.update_metadata` |
| Athlete deauth | Filter `object_type=athlete`; runs `dispatcher.handleAthleteEvent` and the deletion-service subgraph |
| Token refresh | `strava.RefreshToken` inside `strava.FetchActivity`. Its `strava.refresh_reason` attribute says why: `proactive_expiry` (normal — refreshed ahead of expiry), `reactive_401` (Strava rejected a token we thought valid — revoked early), `empty_token` (no stored token, e.g. just after connect). Steady-state webhooks within the ~6h token window have **no** `strava.RefreshToken` span at all. A `WARN "Refreshed Strava token has zero expiry"` log means refresh-ahead will fire every request — investigate the stored token's `expires_at`. |
| Strava retried | `strava.retry` events on `strava.FetchActivity` (transient fetch failures) or `strava.RefreshToken` (token-endpoint failures), with `attempt`/`backoff` and either `status_code` or a short `error`. `strava.attempts` + `strava.exhausted=true` on the parent span mean every retry was used up. |
| Cold start | Filter on `httpRequest.latency` > 2s; expect a gap before the first span |

## What to file vs. what to drop

After pulling a trace, classify the finding:

- **File a follow-up task** if the issue affects every trace of that shape, or if it points at a real architectural gap (e.g. a missing span, a span that should be parallelized).
- **Drop it** if it's expected variance (long-route polyline decode), cold-start noise, or a one-time external blip (Strava 5xx).
- **Note it inline** in the related task's progress log if it's interesting context but not actionable.

## Common pitfalls

- **Don't trust Cloud Trace's compact timeline view alone.** The compact view sorts by duration and can hide structure. Switch to the tree view to see span parentage.
- **Cold-start traces overrepresent latency.** A trace from the first request after idle scales is not representative — pull a few warm traces before drawing conclusions.
- **Span attribute search is fuzzy.** `attribute:desirelines.activity_id=12345` works, but Trace explorer sometimes needs the leading `+` and the exact attribute name. If a search returns nothing, fall back to logs (where the field is the bare `jsonPayload.activity_id`).

## See also

- [observability.md](../architecture/observability.md) — structural explanation of how tracing is wired.
- [webhook-events-absent.md](webhook-events-absent.md) — runbook for "no webhook events received."
