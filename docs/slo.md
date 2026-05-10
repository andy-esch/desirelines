# Service Level Objectives

Reliability targets for the desirelines system, with error budgets and
burn-rate alerts. Read [`docs/architecture/observability.md`](architecture/observability.md)
first if you want the underlying instrumentation context; this doc
assumes the metrics it references already exist.

> **Status:** initial draft 2026-05-10. Targets are starter values
> deliberately set near the achievable baseline; tighten after a
> month of observed data.

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
| 4 | Read | Availability | Apigateway /v1/* request returns < 500 |
| 5 | Read | Latency | Apigateway /v1/* request completes within 1s |

The hourly `/ready` probe is a **canary**, not an SLO — it exists
for static-threshold alerting on prolonged outages but doesn't
define any SLO target.

The bq-inserter is downstream of the ingest path but **explicitly
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
| **Metric source** | Cloud Run `request_count` on the dispatcher service, filtered to `path = /webhook` (all methods, but practically POST), grouped by `status_class` |
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
| **Why postgres-writer only, not bq-inserter** | bq-inserter DLQ failures are archive-only — user sees no impact when BQ is behind. postgres-writer DLQ failures break the dashboard. Asymmetric importance → only the user-facing one rolls into the SLO. bq-inserter has its own static-threshold alert. |
| **Why activity-events only, not deauth-events** | Deauth events are rare and an off-platform concern; the failure mode is "tokens not deleted on time" which is operationally important but not tied to user-noticed product behavior. Separate alert exists. |
| **Rationale** | Captures the "did my upload appear in the dashboard?" question. Distinct from SLO 1: dispatcher could be 100% available while postgres-writer DLQ rises (e.g. broken DB connection). |

### SLO 3 — Webhook ingest latency (data freshness)

| Aspect | Value |
|---|---|
| **SLI** | `% of CREATE webhook events where postgres row is visible within 3s of dispatcher receiving the webhook` |
| **Target** | 95% |
| **Window** | Rolling 30 days |
| **Error budget** | 5% of CREATE webhook events can land slowly without burning the budget |
| **Metric source** | `desirelines.io/webhook/end_to_end.duration` histogram with `aspect_type=create`, recorded by postgres-writer when an activity row is inserted. The elapsed time is `now - dispatcher_received_at` where `dispatcher_received_at` is propagated as a Pub/Sub attribute (`dispatcher_received_at_unix_ms`). |
| **What counts as "good"** | end-to-end < 3000ms |
| **What counts as "bad"** | end-to-end ≥ 3000ms, OR CREATE event was lost (no measurement → counted as failure) |
| **Scope: CREATE-only** | UPDATE and DELETE webhooks don't emit the freshness measurement today. CREATE is the most user-perceived signal ("uploaded activity didn't appear"); UPDATE ("edited title not visible") and DELETE ("deleted activity still showing") are arguably also freshness signals but with less acute impact and lower cadence. Extension is filed as a follow-up task. |
| **Rationale** | 3 seconds is generous for the typical webhook path: dispatcher Strava-fetch (~300-500ms warm) + Pub/Sub publish (~50ms) + Pub/Sub deliver (~50-100ms) + postgres insert (~200ms warm) — well under 1s on warm path. The 3s budget gives breathing room for one cold transient (Neon cold-compute or Cloud Run cold-start) without flapping. Tighten to 2s after a month of warm-path data shows it's achievable. |

### SLO 4 — Apigateway availability

| Aspect | Value |
|---|---|
| **SLI** | `% of /v1/* requests returning HTTP status < 500` |
| **Target** | 99.5% |
| **Window** | Rolling 30 days |
| **Error budget** | ~37-150 5xx responses/month (7.5K-30K requests/month at 0.5%) |
| **Metric source** | Cloud Run `request_count` on the apigateway service, filtered to `path =~ /v1/.*`, grouped by `status_class` |
| **Endpoints included** | `/v1/activities`, `/v1/activities/*`, `/v1/sports/config` |
| **Endpoints excluded** | `/ready`, `/health` (canaries); `/api/auth/*` (OAuth has different failure modes) |
| **Rationale** | Higher volume than dispatcher → tighter target meaningful. 99.5% absorbs individual transient blips (Neon cold compute, Cloud Run cold start) without flapping; sustained issue still trips burn-rate alert quickly. |

### SLO 5 — Apigateway latency

| Aspect | Value |
|---|---|
| **SLI** | `% of /v1/* requests completing in < 1000ms` |
| **Target** | 95% |
| **Window** | Rolling 30 days |
| **Error budget** | 5% of requests can be slow without burning |
| **Metric source** | `desirelines.io/http/request.duration` histogram (workload.googleapis.com prefix per the monitoring.tf convention), filtered to apigateway service + `/v1/*` paths |
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
   public entry points). bq-inserter and postgres-writer are
   downstream — postgres-writer is critical to user experience and
   is captured via SLOs 2 and 3; bq-inserter is archive-only and
   has its own static-threshold alert, not promoted to SLO status.

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

- [ ] **Custom metric prerequisite for SLO 3**: dispatcher emits
      `dispatcher_received_at_unix_ms` Pub/Sub attribute;
      postgres-writer emits `webhook/end_to_end.duration` histogram
      after successful insert. ~50 LOC across two services.
- [ ] SLOs 1, 4, 5 wired as `google_monitoring_slo` in `monitoring.tf`
- [ ] SLOs 2, 3 wired as MQL-based alert policies (no GCP-native
      SLO since the SLI is non-Cloud-Run)
- [ ] Burn-rate alert pairs (fast 1h/14.4× + slow 6h/6×) for each
      of the 5 SLOs, wired to existing notification channels
- [ ] At least one SLO validated via synthetic failure in dev
- [ ] `docs/architecture/observability.md` Metrics section updated
      with canonical metric names + operation labels (folded in
      from the histograms task; can be done alongside any of the
      above)

## References

- Google SRE Workbook: [https://sre.google/workbook/](https://sre.google/workbook/)
- GCP Service Monitoring SLOs: [https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring](https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring)
- Source of truth for alerts and metric definitions:
  [`terraform/modules/desirelines/monitoring.tf`](../terraform/modules/desirelines/monitoring.tf)
- Underlying observability architecture:
  [`docs/architecture/observability.md`](architecture/observability.md)
