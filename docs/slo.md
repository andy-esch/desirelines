# Service Level Objectives

Reliability targets for the desirelines system, with error budgets and
burn-rate alerts. Read [`docs/architecture/observability.md`](architecture/observability.md)
first if you want the underlying instrumentation context; this doc
assumes the metrics it references already exist.

> **Status:** deployed 2026-05. SLOs 1/2/4/5 are live as
> `google_monitoring_slo` in `slos.tf` (dev) with fast/slow burn-rate
> alert pairs; fast-burn alerting was validated end-to-end 2026-05-11
> (see [Implementation status](#implementation-status)). SLO 3 (data
> freshness) is not yet wired — pending a `webhook/end_to_end.duration`
> data window to calibrate its threshold. Targets remain near the
> achievable baseline; retighten after ~a month of observed data.

## Concepts (skim if new)

- **SLI** — a measurement you care about, e.g. "% of webhook events
  processed without hitting the DLQ."
- **SLO** — a target for that SLI over a window, e.g. "99% over a
  rolling 30 days."
- **Error budget** — the inverse of the SLO. 99% over 30 days
  allows 1% failures. The budget is consumed by every failure.
- **Burn rate** — how fast the budget is being spent. 1.0 = on-pace
  to consume 100% over the window; 14.4 = will burn the whole
  budget in 2 days.

The Google SRE Workbook chapters on
[implementing SLOs](https://sre.google/workbook/implementing-slos/)
and
[alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
are the reference reading. Burn-rate alert math comes from the
second.

## Active SLOs

The user-perceived shape of "is desirelines working" splits into two
paths, each measured along two axes (works at all + works fast
enough), giving five SLOs total:

| # | Path | Concern | SLO |
|---|---|---|---|
| 1 | Ingest entry | Availability | Dispatcher /webhook returns 2xx |
| 2 | Ingest end-to-end | Availability | Webhook event lands in postgres without hitting DLQ |
| 3 | Ingest end-to-end | Latency | Webhook → postgres row visible within 3s |
| 4 | Read | Availability | Apigateway request returns < 500 |
| 5 | Read | Latency | Apigateway request completes within 1s |

The hourly `/ready` probe is a **canary**, not an SLO — it exists
for static-threshold alerting on prolonged outages but doesn't
define any SLO target.

The BigQuery CDC path is downstream of the ingest path but **explicitly
excluded** from these SLOs. It's archive-only (user sees no impact
when it fails); its DLQ has its own static-threshold alert. Only
postgres-writer is on the user-noticed critical path.

### SLO 1 — Dispatcher availability

| Aspect | Value |
|---|---|
| **SLI** | `% of POST /webhook requests returning HTTP < 500` |
| **Target** | 99% |
| **Window** | Rolling 30 days |
| **Error budget** | ~1.5-6 failed responses/month (150-600 webhooks/month at 1%) |
| **Metric source** | Cloud Run `request_count` scoped to the dispatcher service via an explicit `resource.label."service_name"` filter, split by `response_code_class`. The parent `google_monitoring_service` binding is organizational only and does **not** restrict the SLI — the explicit `service_name` scope is load-bearing (without it the SLI aggregates every Cloud Run service and SLO 1 silently becomes a byte-identical copy of SLO 4, blind to dispatcher-only regressions). See `slos.tf`. Not path-filtered — `request_count` carries no URL label — but the dispatcher serves only `/webhook`, a `/health` probe, and a `HEAD /` liveness ping, so this is effectively webhook traffic. (The dispatcher has **no** `/ready` endpoint; readiness probes are an apigateway-only surface.) |
| **What counts as "good"** | 2xx, 3xx, 4xx — Strava's retries handle transient blips; what we care about is sustained 5xx |
| **What counts as "bad"** | 5xx (a 5xx that survives Strava's 3 retries = lost webhook) |
| **Rationale** | Volume is low — 99% gives 1.5-6 fails/month budget, which fits the empirical rate of occasional Cloud Run cold-start blips. Tighten to 99.5% after a month of data. Note: a 5xx that Strava successfully retries is invisible to this SLO (good — those are recovered). |

### SLO 2 — Webhook ingest success (end-to-end)

| Aspect | Value |
|---|---|
| **SLI** | `% of activity-events Pub/Sub messages NOT ending up in postgres-writer's DLQ` |
| **Target** | 99% |
| **Window** | Rolling 30 days |
| **Error budget** | ~1.5-6 lost events/month |
| **Metric source** | Pub/Sub subscription metrics — `(received_message_count - undelivered to DLQ) / received_message_count` for the postgres-writer subscription on `activity-events` |
| **Why postgres-writer only, not the BigQuery path** | BigQuery CDC failures are archive-only — user sees no impact when BQ is behind. postgres-writer DLQ failures break the dashboard. Asymmetric importance → only the user-facing one rolls into the SLO. The activity-rows DLQ has its own static-threshold alert. |
| **Why activity-events only, not deauth-events** | Deauth events are rare and an off-platform concern; the failure mode is "tokens not deleted on time" which is operationally important but not tied to user-noticed product behavior. Separate alert exists. |
| **Rationale** | Captures the "did my upload appear in the dashboard?" question. Distinct from SLO 1: dispatcher could be 100% available while postgres-writer DLQ rises (e.g. broken DB connection). |

### SLO 3 — Webhook ingest latency (data freshness)

| Aspect | Value |
|---|---|
| **SLI** | `% of webhook events where the postgres row reflects the change within 3s of dispatcher receiving the webhook` |
| **Target** | 95% |
| **Window** | Rolling 30 days |
| **Error budget** | 5% of webhook events can land slowly without burning the budget |
| **Metric source** | `desirelines.io/webhook/end_to_end.duration` histogram with `aspect_type=create\|update\|delete`, recorded by postgres-writer on each success path (new row inserted / metadata updated / row deleted). The elapsed time is `now - dispatcher_received_at` where `dispatcher_received_at` is propagated as a Pub/Sub attribute (`dispatcher_received_at_unix_ms`). Events that fail before recording (skips, DLQ) are absent from the histogram; the delivery-reliability signal for those is covered separately by SLO 2 (webhook ingest success), so SLO 3 stays focused on latency-of-successful-events without conflating two failure modes in one SLI. |
| **What counts as "good"** | end-to-end < 3000ms on a recorded success-path event |
| **What counts as "bad"** | end-to-end ≥ 3000ms on a recorded success-path event. DLQ losses are NOT counted here (they'd be absent from both numerator and denominator under the planned `distribution_cut` SLI shape); SLO 2 covers that failure mode. |
| **Scope: all aspect_types** | CREATE, UPDATE, and DELETE webhooks all emit the freshness measurement and share the SLO threshold. Per-aspect slicing stays available in Metrics Explorer via the `aspect_type` label if behavior diverges (e.g. UPDATE turns out to be routinely slower because the path differs), at which point splitting into per-aspect SLOs becomes worth doing. |
| **Rationale** | Sized for the actual usage profile. This is a single-user app at 2-5 webhooks/day, so the **typical case is cold-everything**: Neon (5-min idle) is cold ~95%+ of webhooks, Cloud Run (scale-to-zero) is cold most of the time, and Strava token refresh fires on ~50% of webhooks. N=2 production samples show ~1.6-1.7s for the cold + token-refresh path (typical) and ~700ms for the rare back-to-back warm case. 3s gives ~1.4s headroom over the typical case — enough to tolerate compound cold-start without flapping, but tight enough to alert on real degradation. Recalibrate after 7-30 days based on actual p95: may stay at 3s, or push to 4s threshold or 90% target depending on the distribution. |

### SLO 4 — Apigateway availability

| Aspect | Value |
|---|---|
| **SLI** | `% of /v1/* requests returning HTTP status < 500` |
| **Target** | 99.5% |
| **Window** | Rolling 30 days |
| **Error budget** | ~37-150 5xx responses/month (7.5K-30K requests/month at 0.5%) |
| **Metric source** | Cloud Run `request_count` scoped to the apigateway service via an explicit `resource.label."service_name"` filter, split by `response_code_class` (5xx = bad). The parent service binding is organizational only and does **not** restrict the SLI — see `slos.tf`. |
| **Scope: all requests to the service** | `request_count` carries no URL/path label, so the SLI counts **every** request to apigateway — not just `/v1/*`. The path exclusions this row originally claimed (`/ready`+`/health` canaries, `/api/auth/*` OAuth) are **not** applied today. ⚠️ Consequence: apigateway's own `/ready` cold-start 5xx (rare — the handler retries once before returning 503) and any `/api/auth/*` 5xx burn this budget, a smaller dose of the same cold-start contamination the SLI service-scoping (H1) and readiness-metric work (M1) set out to remove. Real path scoping is achievable: apigateway **already emits** `workload.googleapis.com/desirelines.io/http/request.duration` (see `gcplog.HTTPRequestLoggerWithMetrics`) tagged with `http.route`, `http.status_code`, `http.method` — and it already **excludes** `/health`+`/ready`. The planned fix is to rewire SLO 4 (availability, via the histogram's count by `http.status_code`) and SLO 5 onto it, filtered to `/v1/*` routes (which also drops `/api/auth/*`). **Not yet wired — needs live Metrics-Explorer verification first**: it exports under `generic_task` (not `cloud_run_revision`), so the service-identity label and the OTel→GCP-sanitized label names (e.g. `http.route` vs `http_route`) must be confirmed, plus the OTel-metric first-apply gating noted at line 85. Tracked as a follow-up. |
| **Rationale** | Higher volume than dispatcher → tighter target meaningful. 99.5% absorbs individual transient blips (Neon cold compute, Cloud Run cold start) without flapping; sustained issue still trips burn-rate alert quickly. |

### SLO 5 — Apigateway latency

| Aspect | Value |
|---|---|
| **SLI** | `% of /v1/* requests completing in < 1000ms` |
| **Target** | 95% |
| **Window** | Rolling 30 days |
| **Error budget** | 5% of requests can be slow without burning |
| **Metric source** | Cloud Run native `request_latencies` distribution scoped to the apigateway service via an explicit `resource.label."service_name"` filter (parent binding is organizational only — see `slos.tf`), counting non-5xx responses (`response_code_class != "5xx"`) that complete within the 1000ms cut. Same "all requests to the service, no path label" scope caveat as SLO 4. |
| **Rationale** | Sub-second is the right "feels responsive" target for the dashboard. 95% is conservative — observed warm-path p95 from production traces was 21-118ms, so the 1000ms budget includes plenty of headroom for cold-start variance. Tighten if real p95 stabilizes well below 500ms. |

## Error budget policy

When the error budget for an SLO is exhausted (or close to it):

| Status | Meaning | Action |
|---|---|---|
| **>50% budget remaining** | Healthy | No constraint on feature work |
| **10-50% remaining** | Watch | Be deliberate about deploys; weight reliability work |
| **<10% remaining** | Tight | Prioritize reliability fixes over features in the next sprint |
| **0% remaining (budget exhausted)** | Spent | _Decision: see "Decisions log" below._ Default policy: prioritize reliability work in the next sprint until the budget recovers; do not freeze deploys. |

For a solo-maintained project, "freeze all feature work" is too
strict. The pragmatic policy is "the next thing you work on after a
budget exhaustion is reliability, not features."

## Burn-rate alerts

Each SLO gets two burn-rate alerts following the
[multi-window, multi-burn-rate pattern](https://sre.google/workbook/alerting-on-slos/#5-multiwindow-multi-burn-rate-alerts):

| Alert | Burn rate | Window | Means |
|---|---|---|---|
| **Fast-burn** | 14.4 | 1 hour | Will burn 100% of 30-day budget in ~2 days at this rate; active incident |
| **Slow-burn** | 6 | 6 hours | Will burn 100% of 30-day budget in ~5 days at this rate; ticketed degradation |

Routing:

- **Fast-burn → email + Slack**, treat as paging-equivalent.
- **Slow-burn → Slack only**, lower urgency.

(Existing `local.notification_channels` in `monitoring.tf` is the
target; SLO alerts reuse it.)

## Decisions log

Resolved 2026-05-10:

1. **GCP-native vs MQL**: **Mix.** GCP-native `google_monitoring_slo`
   for Cloud Run availability/latency (SLOs 1, 4, 5); MQL-based
   alerts for the Pub/Sub DLQ ratio and the custom freshness
   histogram (SLOs 2, 3). Easy to flip a single SLO from one to the
   other if the choice turns out wrong.

2. **Data freshness SLI**: **Include** (SLO 3 above). Requires the
   new `webhook/end_to_end.duration` custom metric — see "Pending
   custom metric for SLO 3" subsection.

3. **Availability SLO scope**: **apigateway + dispatcher** (both
   public entry points). postgres-writer and the BigQuery CDC path
   are downstream — postgres-writer is critical to user experience
   and is captured via SLOs 2 and 3; the BigQuery path is
   archive-only, has no service to measure availability on, and
   carries its own static-threshold DLQ alert instead.

4. **Error budget policy**: **Medium** — when budget is exhausted
   on a given SLO, the next sprint's first work item is reliability
   on that surface, not features. No deploy freeze.

5. **Alert routing**:
   - Fast-burn → Slack + email (paging-equivalent)
   - Slow-burn → Slack only (lower urgency)
   - Reuse existing `local.notification_channels` in `monitoring.tf`

## Implementation status

**Decisions:**

- [x] SLO 1 (dispatcher availability) target chosen — 99%
- [x] SLO 2 (webhook ingest success) target chosen — 99%
- [x] SLO 3 (data freshness) target chosen — 95% under 3s
- [x] SLO 4 (apigateway availability) target chosen — 99.5%
- [x] SLO 5 (apigateway latency) target chosen — 95% under 1s
- [x] All five framework decisions resolved (see Decisions log)

**Code work (in dependency order):**

- [x] **Custom metric prerequisite for SLO 3**: shipped in PR #598.
      Dispatcher stamps `dispatcher_received_at_unix_ms` Pub/Sub
      attribute; postgres-writer records
      `desirelines.io/webhook/end_to_end.duration` histogram after
      each successful CREATE insert.
- [x] SLOs 1, 4, 5 wired as `google_monitoring_slo` in `slos.tf`
      (PRs #600, #602) — verified live in Cloud Monitoring →
      Services for dev.
- [x] Burn-rate alert pairs (fast 1h/14.4× + slow 6h/6×) wired for
      SLOs 1, 4, 5 — 6 alert policies, all in "OK" state.
- [x] `docs/architecture/observability.md` Metrics section updated
      with canonical metric names + operation labels (shipped
      alongside PR #598).
- [x] **SLO 2** wired (Pub/Sub DLQ ratio) in PRs #603/#604. Bound
      to the postgres-writer Cloud Run service (`basic_service`
      with `CLOUD_RUN`) since `google_monitoring_service` requires
      a `basic_service` or `telemetry` block — custom services
      aren't supported by Terraform today. Burn-rate alert pair
      follows the same pattern as SLOs 1/4/5.
- [x] **Synthetic-fault endpoint** deployed in PR #603 at
      `/v1/__synthetic_fault__`. Environment-gated (off in prod via
      `EnableSyntheticFaults` flag), auth-gated, and cleanly
      removable — see `packages/apigateway/internal/synthetic/handler.go`
      for removal steps.
- [ ] **SLO 3** wired (data freshness). Awaiting ~7-30 days of
      `webhook/end_to_end.duration` data so the 3s threshold can
      be calibrated against actual p95 before committing in
      Terraform.
- [x] **Validate fast-burn alert end-to-end** — confirmed
      2026-05-11 by repeatedly hitting `/v1/__synthetic_fault__`
      (Firebase ID token from Network tab; loop of 200 5xx GETs).
      Burn-rate alert fired through both email and Slack within
      the expected ~10-15 min window. SLO budget burn visible in
      Cloud Monitoring → Services. End-to-end alerting wiring is
      proven for the GCP-native SLO shape.

## References

- Google SRE Workbook: [https://sre.google/workbook/](https://sre.google/workbook/)
- GCP Service Monitoring SLOs: [https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring](https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring)
- Source of truth for alerts and metric definitions:
  [`terraform/modules/desirelines/monitoring.tf`](../terraform/modules/desirelines/monitoring.tf)
- Underlying observability architecture:
  [`docs/architecture/observability.md`](architecture/observability.md)
