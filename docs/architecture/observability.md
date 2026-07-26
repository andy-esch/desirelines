# Observability

How tracing, logging, and metrics fit together across the desirelines services. This is a **structural** doc — for the operational "I'm staring at a slow trace, now what" question, see [docs/runbooks/reading-traces.md](../runbooks/reading-traces.md).

## What you get out of the box

Every service in the project (Go and Python) is instrumented with OpenTelemetry and exports to Google Cloud:

- **Traces** → Cloud Trace
- **Metrics** → Cloud Monitoring (custom metrics under `desirelines.io/`)
- **Logs** → Cloud Logging (structured JSON, automatically linked to traces)

A single Strava webhook produces one trace that spans the dispatcher (Go) → Pub/Sub → bq-inserter (Python) → postgres-writer (Python). Logs from any of those services that fire while a span is active appear under "Show logs" on that trace in Cloud Trace.

## Cross-language trace topology

```
                                  ┌─────────────────────┐
   Strava POST /webhook ─────────▶│ desirelines-        │
                                  │   dispatcher (Go)   │
                                  │                     │
                                  │  spans:             │
                                  │  - POST /webhook    │ ← otelhttp
                                  │  - dispatcher.      │
                                  │      allowlist_check│
                                  │  - strava.          │
                                  │      fetch_activity │
                                  │  - firestore.       │
                                  │      get_tokens     │
                                  │  - pubsub.publish   │ ← injects traceparent
                                  └──────────┬──────────┘
                                             │ Pub/Sub message
                                             │ attributes: { traceparent, ... }
                                             ▼
                          ┌──────────────────┴──────────────────┐
                          ▼                                     ▼
              ┌───────────────────────┐           ┌───────────────────────┐
              │ desirelines-          │           │ desirelines-          │
              │   bq-inserter (Py)    │           │   postgres-writer (Py)│
              │                       │           │                       │
              │  bq_inserter.         │           │  postgres_writer.     │
              │    webhook.process    │           │    webhook.process    │
              │  └─ bigquery.         │           │  └─ postgres.insert   │
              │       insert_rows     │           │     ├─ postgres.      │
              │     ├─ bigquery.      │           │     │   session.      │
              │     │   write_to_     │           │     │   acquire       │
              │     │   staging       │           │     ├─ postgres.      │
              │     ├─ bigquery.      │           │     │   activities.   │
              │     │   merge_from_   │           │     │   insert        │
              │     │   staging       │           │     ├─ postgres.      │
              │     └─ bigquery.      │           │     │   polyline.     │
              │         cleanup_      │           │     │   decode        │
              │         staging       │           │     ├─ postgres.      │
              │                       │           │     │   activities.   │
              │                       │           │     │   insert_route  │
              │                       │           │     └─ postgres.commit│
              └───────────────────────┘           └───────────────────────┘
```

The same `trace_id` flows end-to-end. The bq-inserter and postgres-writer roots (`bq_inserter.webhook.process` and `postgres_writer.webhook.process`) appear as children of the dispatcher's `pubsub.publish` span.

The Python consumers are also FastAPI- and SQLAlchemy-instrumented: each inbound CloudEvent POST gets an HTTP **server span** (routing + body-parse time), and every SQL statement gets its own span nested under the handler's `postgres.*` spans. One deliberate gap: the server span continues the *HTTP delivery's* trace context, not the dispatcher's — the cross-service `traceparent` rides in the Pub/Sub message body, which a header-based server span can't see. So the FastAPI server span sits in a separate short trace from `webhook.process`; unifying them is a known follow-up.

The deauth path is a separate subgraph:

```
dispatcher.handleAthleteEvent
  └─ deauth_events publish
       └─ deletion_service.deletion.process
            ├─ deletion.firestore
            ├─ deletion.postgres
            └─ deletion.bigquery
```

Note there is no `allowlist_check` span here (unlike the activity path): deauth is
cleanup and deliberately bypasses the allowlist, so it also emits no
`webhook/owner_check` metric. See the dispatcher README's Deauthorization section.

### Backfill job trace topology

Backfill is a separately invoked Cloud Run Job, not a continuation of a webhook.
Each requested year therefore starts an explicitly detached `backfill.year` root
trace:

```
backfill.year
  ├─ Strava fetch and retry events
  ├─ postgres.session.acquire
  ├─ SQLAlchemy statement spans
  ├─ postgres.commit
  ├─ bigquery.write_batch_to_staging   (when BigQuery is enabled)
  ├─ bigquery.merge_batch_from_staging (when BigQuery is enabled)
  └─ bigquery.cleanup_staging          (when BigQuery is enabled)
```

An empty OTel parent context prevents an ambient request or webhook trace from
becoming the parent. A multi-year job creates one independent trace per year
rather than one potentially unbounded trace for the entire run. PostgreSQL and
BigQuery receive the same injected tracer, so their spans inherit the active
year root; PostgreSQL-only runs retain the same topology without requiring a
BigQuery writer. Job teardown closes sink resources, disposes the SQLAlchemy
engine, and then flushes tracing without allowing exporter failure to change the
process exit code. The job-wide correlation ID remains the cross-year log handle.

## How propagation actually works

There are two propagators registered globally on the Go side, in this order:

1. `CloudTraceOneWayPropagator` (extract-only) — reads the `X-Cloud-Trace-Context` header injected by Cloud Run.
2. `TraceContext` (W3C, extract+inject) — reads/writes the standard `traceparent` header.

The order matters: when an incoming request carries **both** headers, W3C extracts second and wins, which is the correct behavior for service-to-service calls that already propagate `traceparent`. The dispatcher's entry point (called by Strava) only has `X-Cloud-Trace-Context`, so the GCP propagator supplies the `trace_id` that OTel adopts. Result: the OTel `trace_id` matches the one `gcplog` writes into structured log fields, so Cloud Trace's "Show logs" feature works.

For outgoing propagation:

- **Go → Pub/Sub**: `dispatcher/adapters/pubsub/publisher.go` injects `traceparent` into the message attributes via `otel.GetTextMapPropagator().Inject()`.
- **Python ← Pub/Sub**: `stravapipe/shared/tracing.py:extract_context_from_attributes()` extracts it; the shared `handle_webhook_cloudevent()` helper threads it into `record_span(parent_context=...)`.

If either side breaks, the consumer's root span has no parent in Cloud Trace.

See [`packages/shared/otel/provider.go`](../../packages/shared/otel/provider.go) for the propagator wiring and [`packages/stravapipe/src/stravapipe/shared/tracing.py`](../../packages/stravapipe/src/stravapipe/shared/tracing.py) for the Python side.

**Regression guards.** Both halves of the propagation chain are covered at PR time:

- *Inject side (Go):* the custom [`lintpub`](../../packages/shared/otel/lintpub/) analyzer (wired into `just go-lint` and the `go-quality` CI matrix) flags any new `*pubsub.Publisher.Publish(...)` call site that isn't paired with a `propagator.Inject(...)` in the same function — catches "new publish path forgot to inject."
- *Extract side (Python):* `tests/unit/cloudrun/test_trace_propagation.py` drives both extract paths — the shared `handle_webhook_cloudevent()` helper (bq-inserter, postgres-writer) and `deletion_service_app`'s own path — through a real handler with an in-memory span exporter, asserting the processing span adopts the inbound `traceparent` trace-id. `tests/unit/shared/test_tracing.py` covers the `extract_context_from_attributes()` round-trip at the unit level.

## Trust boundaries: dispatcher vs. apigateway

The two HTTP-fronted services treat incoming trace context **differently** because their callers have different trust profiles:

| Service | otelhttp option | Behavior on incoming `traceparent` |
|---|---|---|
| `desirelines-dispatcher` | default (continue trace) | Adopts caller's trace_id. Callers are Strava webhooks (via signed subscription) and PubSub push (Cloud Run IAM-authenticated) — both trusted. |
| `desirelines-apigateway` | `WithPublicEndpointFn(true)` | Starts a **fresh** root span with a new trace_id; attaches the caller-supplied span context as a `Link`. |

The apigateway's setting is in [`packages/apigateway/cmd/apigateway/main.go`](../../packages/apigateway/cmd/apigateway/main.go). Without it, a client could:

- Inject a chosen trace_id to pollute or interleave traces (denial-of-value on trace search).
- Collide their request with an unrelated internal trace.
- Submit malformed/oversized IDs that waste ingestion quota.

The `Link` keeps caller correlation available when it's a legitimate client (e.g. the React frontend), without trusting their ID for our trace tree.

### Browser → apigateway propagation

Frontend axios client ([`packages/web/src/api/client.ts`](../../packages/web/src/api/client.ts)) injects a W3C `traceparent` on internal requests, gated on `isInternalRequest()`. Trace-id is minted per navigation by [`packages/web/src/api/trace.ts`](../../packages/web/src/api/trace.ts) (wired via TanStack Router's `onBeforeNavigate` in `packages/web/src/router.tsx`); CORS allows the header in [`packages/apigateway/pkg/cors/cors.go`](../../packages/apigateway/pkg/cors/cors.go).

Apigateway public-endpoint mode (trust-boundaries table above) links — never parents — on this header. The fresh-root span's `Link` carries the browser's `traceparent` trace-id/span-id; verified end-to-end through the Firebase Hosting `/api/**` rewrite to Cloud Run. For path-independent correlation, every response also carries `X-Trace-Id` (see "Trace IDs in error responses" below).

## Trace IDs in error responses

API error responses include the active span's `trace_id` so support can jump straight to Cloud Trace from a bug report:

```json
{
  "error": "Allowlist read failed",
  "code": "ALLOWLIST_CHECK_FAILED",
  "request_id": "...",
  "trace_id": "32beef1f57fe81b77a21a940a9e90080"
}
```

The field is the **raw 32-char hex** (no `projects/<p>/traces/` prefix) — paste-friendly for users. Implemented in [`packages/shared/apierrors/response.go`](../../packages/shared/apierrors/response.go); both the dispatcher and apigateway pick it up automatically because they share the apierrors package. The field is `omitempty`, so requests without an active span don't emit a misleading empty value.

Apigateway also stamps the same value on **every response** (success and error) as the `X-Trace-Id` header via [`TraceIDResponseHeader`](../../packages/shared/otel/chi.go) middleware, and exposes it cross-origin via CORS `Access-Control-Expose-Headers`. The browser axios client ([`packages/web/src/api/client.ts`](../../packages/web/src/api/client.ts)) reads it and logs to console in dev. This is the success-path / opaque-failure backstop for the apierrors body field, which only covers apierrors-shaped errors — network failures, gateway 5xxs, and other non-apierrors paths still get a trace handle via the header.

## Sampling

**100% sampling (`AlwaysSample`)** today. Rationale:

- Single-user request volume is negligible, so Cloud Trace ingestion cost doesn't show in billing.
- Full fidelity makes every user-reported issue and every error path investigable.

When/if traffic grows enough to make sampling necessary, the right replacement is `ParentBased(TraceIDRatioBased(X))` paired with a custom sampler that **force-samples error paths** so failures are never dropped. Don't silently lower the rate without that pairing — see the inline note in [`provider.go`](../../packages/shared/otel/provider.go) for context.

## The `ENABLE_OTEL_TRACING` flag (Python only)

Python services gate OTel SDK initialization on `ENABLE_OTEL_TRACING=true`. When unset:

- `setup_tracing()` returns a no-op tracer.
- `record_span()` becomes a context manager that just yields (no span emitted).
- All trace-related code paths still run; they just don't export.

Why a flag in Python but not Go? Historical: the Python OTel SDK was once flaky in cold-start paths and we wanted an off switch. The Go SDK has been reliable and never needed one. The flag is set to `true` in production via Terraform ([`cloud_run.tf`](../../terraform/modules/desirelines/cloud_run.tf)). Leave it unset locally unless you're testing tracing.

## Local OTLP override (`OTEL_EXPORTER_OTLP_ENDPOINT`)

Both Go ([`provider.go`](../../packages/shared/otel/provider.go)) and Python ([`tracing.py`](../../packages/stravapipe/src/stravapipe/shared/tracing.py)) check the standard OTel env vars `OTEL_EXPORTER_OTLP_ENDPOINT` (or the trace-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) on startup. When either is set, the trace exporter swaps from Cloud Trace to OTLP/gRPC — spans flow to whatever Collector or Jaeger instance the endpoint points at instead of leaving the process. Unset → Cloud Trace as usual.

Useful for ad-hoc local debugging: run a Jaeger all-in-one container (`docker run -p 4317:4317 -p 16686:16686 jaegertracing/all-in-one`), set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` on a service, and its spans land in Jaeger's UI instead of leaving the process.

## Authoring spans

### Go services

Use the `sharedotel.StartSpan` helper from [`packages/shared/otel/helpers.go`](../../packages/shared/otel/helpers.go):

```go
ctx, done := sharedotel.StartSpan(ctx, h.tracer, "dispatcher.allowlist_check",
    attribute.Int64("owner_id", ownerID),
)
allowed, err := h.allowlist.IsAllowed(ctx, ownerIDStr)
done(err)  // records error + sets ERROR status if non-nil; ends the span
```

The `done(err)` ergonomics means **always pass the error**, even if it's `nil` — that's how the helper records OK status and ends the span.

### Python services

Use the `record_span` context manager from [`stravapipe/shared/tracing.py`](../../packages/stravapipe/src/stravapipe/shared/tracing.py):

```python
with record_span(self._tracer, "bigquery.merge_from_staging", {"activity_id": activity_id}):
    result = self._client.execute_merge_query(merge_query, params)
```

On exception, the span automatically gets `record_exception()` and ERROR status. The tracer parameter is `Tracer | None` — pass `None` in tests or in code paths that don't need tracing (it no-ops).

### Threading the tracer through adapters

OTel tracers are dependencies. In this project we **inject** them rather than reaching for the global provider, because:

1. Tests can assert spans by passing in a mock or in-memory tracer.
2. The dependency graph stays explicit — you can see at a glance which adapters emit spans.

See examples:

- `ActivitiesWriter(client, dataset_name=..., tracer=...)` in [`adapters/gcp/_bigquery.py`](../../packages/stravapipe/src/stravapipe/adapters/gcp/_bigquery.py)
- `SqlAlchemyUnitOfWork(session_factory, tracer=...)` in [`adapters/postgres/_unit_of_work.py`](../../packages/stravapipe/src/stravapipe/adapters/postgres/_unit_of_work.py)
- `BackfillService(..., tracer=...)` in [`application/backfill/service.py`](../../packages/stravapipe/src/stravapipe/application/backfill/service.py)
- The `Handler` struct in [`dispatcher/adapters/http/handler.go`](../../packages/dispatcher/adapters/http/handler.go)

Cloud Run lifespans (`bq_inserter_app.py`, `postgres_writer_app.py`) and the
backfill job initialize the tracer **before** constructing adapters that need it.

## Span naming conventions

- **Lowercase, dotted** — `bigquery.merge_from_staging`, not `BigQueryMergeFromStaging`.
- **Service-prefix** when the same logical operation can run in multiple services — `bq_inserter.webhook.process` vs. `postgres_writer.webhook.process`. Cloud Trace's compact view shows only the span name; the OTel `service.name` resource attribute disambiguates in detail view but not in the timeline.
- **Operation-scoped, not infrastructure-scoped** — `postgres.activities.insert` says what; `query_database` doesn't.

## Span attributes

- **Dotted lowercase** keys — `activity_id`, `correlation_id`, `owner_id`. Not `ActivityID`, not `activityId`.
- Prefer **identifiers** over **content** — `activity_id=12345` is useful in a trace search; `activity_name="Morning Run"` is PII.
- Keep them small. Cloud Trace truncates large attribute values.

## Logs ↔ Trace correlation

Both Go and Python emit structured JSON logs that Cloud Logging links to traces automatically:

- **Go** — `gcplog.WithCloudTraceContext` middleware adds `trace`, `spanId`, `traceSampled` to log records. See [`packages/shared/gcplog`](../../packages/shared/gcplog/).
- **Python** — `correlation.set_trace_context()` writes to a contextvar that the `google-cloud-logging` library reads when emitting records. The `webhook_handler.py` parent span wraps every log call inside a request so the IDs are populated.

Result: open a trace in Cloud Trace, click "Show logs", see all related log entries. **Don't emit logs outside the active span** — they won't be linked.

## Metrics

All custom OTel metrics use the `desirelines.io/` namespace and land in
Cloud Monitoring under `workload.googleapis.com/desirelines.io/...` (the
default prefix used by `opentelemetry-operations-go/exporter/metric`'s
`mexporter.New()` in [`provider.go`](../../packages/shared/otel/provider.go)).
**Don't use the legacy `custom.googleapis.com/...` prefix** — it's empty
under current SDK versions and any filters using it return no data.

Metrics export interval: **60 seconds** (Cloud Monitoring's minimum
resolution for custom metrics).

### Histograms (latency)

| Metric | Service | Labels (operation=) | Notes |
|---|---|---|---|
| `bigquery/operation.duration` | bq-inserter | `insert_rows`, `merge_from_staging`, `merge_batch_from_staging`, `dml` | Outer + sub-operation timings; MERGE step is the dominant ingest cost (~73% of `insert_rows`) |
| `postgres/operation.duration` | postgres-writer | `insert`, `activities_insert`, `update_metadata`, `delete` | `activities_insert` surfaces Neon cold-compute (warm ~180ms, cold ~1s+) |
| `postgres/query.duration` | apigateway | `year_metadata`, `get_by_id`, `list`, `list_routes`, `multi_sport_metrics_by_date_range`, `multi_sport_daily_summary_by_date_range` | One label per repository read method; matches span names |
| `auth/verify_id_token.duration` | apigateway | (none) | Firebase ID-token verification. Histogram name matches the `auth.verify_id_token` span 1:1 (convention from histogram-label alignment cleanup). |
| `strava/api.duration` | dispatcher | `fetch_activity`, `refresh_token` | Strava-side latency |
| `pubsub/publish.duration` | dispatcher | (per topic) | Publish latency |
| `firestore/operation.duration` | dispatcher | (per op) | Firestore read/write latency |
| `http/request.duration` | apigateway, dispatcher | `http.method`, `http.status_code`, `http.route` (chi route pattern, e.g. `/activities/{id}`) | Emitted by `gcplog.HTTPRequestLoggerWithMetrics` (`packages/shared/gcplog/middleware.go`) — **not** otelhttp, whose built-in HTTP server metrics are deliberately left unregistered ([`provider.go`](../../packages/shared/otel/provider.go)). **Excludes** probe paths `/health`+`/ready` (`!isProbePath`). Anchors apigateway availability/latency — see [SLO 4](../slo.md#slo-4--apigateway-availability). |
| `http.server.duration` | bq-inserter, postgres-writer, deletion-service | OTel `http.*` attrs | Auto-emitted by FastAPI instrumentation (ms; **not** `desirelines.io/`-namespaced). The OTel-standard ingress histogram — distinct from the Go `http/request.duration` above; union both for a cross-pipeline view rather than renaming either. |
| `webhook/end_to_end.duration` | postgres-writer | `aspect_type=create\|update\|delete` | End-to-end webhook freshness from dispatcher receive to postgres row visible/updated/removed. Anchors [SLO 3](../slo.md#slo-3--webhook-ingest-latency-data-freshness). Emitted only on success paths (new insert, metadata updated, row deleted) so skips and DLQ don't pollute the latency distribution. |

### Counters

| Metric | Service | Labels | Notes |
|---|---|---|---|
| `webhook/events` | dispatcher, bq-inserter, postgres-writer | `aspect_type`, `object_type` | Webhook events processed |
| `webhook/owner_check` | dispatcher | `result=allowed\|stray\|orphan\|error` | Allowlist outcomes |
| `ratelimit/rejected` | apigateway, dispatcher | `reason=over_limit\|map_full`, `limiter=default\|auth\|tile\|dispatcher` | Requests rejected (429) by the per-IP rate limiter. `over_limit` = the IP's token bucket is empty; `map_full` = the per-IP client map is at `MaxClients`. Rejections short-circuit before `HTTPRequestLoggerWithMetrics`, so this counter (not the request-duration histogram) is the app-level signal for rate-limiting. |

### Gauges

| Metric | Service | Labels | Notes |
|---|---|---|---|
| `postgres/pool.connections` | apigateway | `state=idle\|in_use\|total` | pgxpool connection state, reported via async observable callback |

### Span ↔ metric alignment

For most histograms, the `operation` label value matches the span name
1:1 (convention adopted after a histogram-label alignment cleanup).
That makes "find the metric for span X" mechanical:

- Span `repository.activities.list_routes` → histogram `postgres/query.duration{operation="list_routes"}`
- Span `bigquery.merge_from_staging` → histogram `bigquery/operation.duration{operation="merge_from_staging"}`

Span attributes don't propagate into histogram labels — they're
trace-only. If you need a span attribute as a histogram label, you have
to add it explicitly to `record_duration`.

## What's *not* instrumented

Deliberate omissions, so traces stay readable:

- **Pydantic validation** in Python services — sub-millisecond, would clutter traces.
- **`parseAndValidateWebhook`, `checkSubscriptionID`** in the dispatcher — fast, same reason.

If you find yourself reaching for these during an investigation, you've probably hit a real gap; flag it.

## Files at a glance

| File | What it does |
|---|---|
| [`packages/shared/otel/provider.go`](../../packages/shared/otel/provider.go) | Go OTel `Setup()` — exporters, propagators, sampler, no-op fallback |
| [`packages/shared/otel/helpers.go`](../../packages/shared/otel/helpers.go) | `StartSpan` and `RecordDuration` helpers |
| [`packages/shared/otel/chi.go`](../../packages/shared/otel/chi.go) | chi middleware that stamps request IDs onto spans |
| [`packages/shared/gcplog/middleware.go`](../../packages/shared/gcplog/middleware.go) | Trace/log correlation middleware (Go) |
| [`packages/stravapipe/src/stravapipe/shared/tracing.py`](../../packages/stravapipe/src/stravapipe/shared/tracing.py) | Python `setup_tracing`, `record_span`, propagator extract |
| [`packages/stravapipe/src/stravapipe/shared/correlation.py`](../../packages/stravapipe/src/stravapipe/shared/correlation.py) | Python contextvars for log/trace correlation |
| [`packages/stravapipe/src/stravapipe/shared/metrics.py`](../../packages/stravapipe/src/stravapipe/shared/metrics.py) | Python `setup_metrics`, `record_duration` |

## A bit of history

Useful context for reading the OTel code:

- **Metrics were instrumented before traces** (Apr 2026). That's why `Setup()` in `provider.go` has two distinct exporter blocks — they were added in different rounds of work. Both go through the same OTel SDK; the split is historical, not architectural.
- **Trace context propagation across Pub/Sub** was added once and has stayed stable. The Go side injects via `propagation.MapCarrier(attrs)` on the message attributes; the Python side extracts via `opentelemetry.propagate.extract()`. If a future change rebuilds the publish path or a new subscriber gets added, that propagation chain is the easy thing to forget.
- **`PubSubMessage.attributes`** was originally dropped silently on the Python side. It's now a `dict[str, str]` field on the model and the `correlation_id` from the dispatcher flows through. Test fixtures that build PubSub bodies must include attributes.

For the regression-test angle (a synthetic webhook driven through all 5 hops asserting a single `trace_id` end-to-end), an end-to-end propagation test is on the backlog but not yet implemented.

## See also

- [docs/runbooks/reading-traces.md](../runbooks/reading-traces.md) — how to find and interpret a specific trace.
- [Pub/Sub Subscription Design](pubsub-subscription-design.md) — how trace context flows through Pub/Sub message attributes.
