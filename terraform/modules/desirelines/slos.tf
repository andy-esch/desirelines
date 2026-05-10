# ============================================================================
# Service Level Objectives
# ============================================================================
# SLOs and their burn-rate alerts. Spec lives in `docs/slo.md`; this file is
# the implementation. Burn-rate math follows the SRE Workbook's multi-window
# pattern — fast-burn (1h, 14.4× rate) for active incidents and slow-burn
# (6h, 6× rate) for sustained mild degradation. Notifications routed per
# `docs/slo.md`'s Decisions log: fast-burn → email + Slack, slow-burn →
# Slack only (lower urgency).
#
# GCP-native SLOs (this file): SLO 1 (dispatcher availability),
# SLO 4 (apigateway availability), SLO 5 (apigateway latency). All three
# attach to Cloud Run services via `google_monitoring_service` with
# `basic_service { service_type = "CLOUD_RUN" }` and use Cloud Run's
# native metrics (request_count, request_latencies).
#
# MQL-based SLOs (separate from this file): SLO 2 (Pub/Sub DLQ ratio) and
# SLO 3 (custom freshness histogram). These target non-Cloud-Run signals
# and are implemented as alert policies with MQL queries rather than
# google_monitoring_slo resources.
# ============================================================================

# Notification routing: fast-burn alerts (paging-equivalent) reuse
# `local.notification_channels` (email + Slack); slow-burn alerts use
# `local.slack_only_notification_channels`. Both locals live in monitoring.tf
# alongside the channel resource definitions.

# ============================================================================
# Service definitions — required parent for google_monitoring_slo resources.
# ============================================================================

resource "google_monitoring_service" "apigateway" {
  service_id   = "${var.project_name}-api-gateway-svc"
  display_name = "Desirelines API Gateway"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = google_cloud_run_v2_service.api_gateway.name
      location     = google_cloud_run_v2_service.api_gateway.location
    }
  }
}

resource "google_monitoring_service" "dispatcher" {
  service_id   = "${var.project_name}-dispatcher-svc"
  display_name = "Desirelines Dispatcher"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = google_cloud_run_v2_service.dispatcher.name
      location     = google_cloud_run_v2_service.dispatcher.location
    }
  }
}

# ============================================================================
# SLO 4 — Apigateway availability (target: 99.5% over 30 days)
# ============================================================================
# SLI definition (from docs/slo.md): "% of /v1/* requests returning HTTP < 500".
#
# Implementation note: this measures whole-apigateway availability, not
# strictly /v1/*. Cloud Run's native `request_count` metric carries
# `response_code_class` but no path label, so /ready, /health, and
# /api/auth/* are included. For a single-user app this imprecision is
# acceptable: those endpoints are reliably 200 (which inflates the SLO
# slightly toward "more available") and OAuth callback failures are rare
# enough not to materially shift the calculation. If we ever need strict
# /v1/* scoping, swap to an MQL-based SLO using the OTel
# `http/request.duration` histogram which has http.route labels.

resource "google_monitoring_slo" "apigateway_availability" {
  # Use `.name` (full resource path) rather than `.service_id` — the
  # canonical reference for cross-resource pointers in GCP. The provider
  # accepts either form (strips the path prefix internally), but `.name`
  # is defensive against provider behavior tightening.
  service             = google_monitoring_service.apigateway.name
  slo_id              = "apigateway-availability"
  display_name        = "Apigateway availability — 99.5% over 30d"
  goal                = 0.995
  rolling_period_days = 30

  request_based_sli {
    good_total_ratio {
      bad_service_filter   = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.\"response_code_class\"=\"5xx\""
      total_service_filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\""
    }
  }
}

# ============================================================================
# SLO 4 — Burn-rate alerts
# ============================================================================
# Fast-burn (1h / 14.4× rate): consuming the 30-day budget at this rate would
# exhaust it in ~2 days. Treated as paging-equivalent — both email + Slack.
# At 99.5% goal, 14.4× rate means bad-rate exceeds 7.2% over 1h.

resource "google_monitoring_alert_policy" "slo_4_apigateway_availability_fast_burn" {
  display_name = "SLO 4 (apigateway availability) — fast burn (1h)"
  combiner     = "OR"

  conditions {
    display_name = "Fast burn: 14.4× rate over 1 hour"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_availability.name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 14.4
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    content   = <<-EOT
      The apigateway availability SLO is burning fast. At the current rate
      the 30-day error budget will be exhausted in ~2 days.

      **Targets**: 99.5% of `/v1/*` requests return < 500 over rolling 30d.
      **Error budget**: ~37-150 5xx responses/month at typical volume.

      **Investigate**:
      - Recent deploys on apigateway
      - Cloud Run instance health (cold-start spikes, OOM kills)
      - Database connectivity (postgres pool, Neon compute)
      - Firebase auth verification failures (separate auth metric)

      **Spec**: `docs/slo.md` SLO 4.
      **Triage**: `docs/runbooks/reading-traces.md` for trace inspection.
    EOT
    mime_type = "text/markdown"
  }
}

# Slow-burn (6h / 6× rate): consuming budget at 6× normal rate exhausts it
# in ~5 days. Lower urgency than fast-burn — Slack only, no email.
# At 99.5% goal, 6× rate means bad-rate exceeds 3% over 6h.

resource "google_monitoring_alert_policy" "slo_4_apigateway_availability_slow_burn" {
  display_name = "SLO 4 (apigateway availability) — slow burn (6h)"
  combiner     = "OR"

  conditions {
    display_name = "Slow burn: 6× rate over 6 hours"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_availability.name}\", \"21600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 6.0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.slack_only_notification_channels

  documentation {
    content   = <<-EOT
      The apigateway availability SLO is burning slowly — sustained mild
      degradation. At 6× normal rate, the 30-day error budget would deplete
      in ~5 days.

      Lower urgency than fast-burn; investigate in the next working session.

      Same investigation steps as the fast-burn alert; see `docs/slo.md`
      SLO 4.
    EOT
    mime_type = "text/markdown"
  }
}

# ============================================================================
# SLO 1 — Dispatcher availability (target: 99% over 30 days)
# ============================================================================
# SLI: % of POST /webhook requests returning HTTP < 500.
#
# Lower target than apigateway (99% vs 99.5%) because volume is much lower
# (~150-600 webhooks/month vs ~7.5K-30K apigateway requests/month). At low
# volume, tighter targets flap on individual transient blips. 99% gives
# 1.5-6 fails/month budget — fits the empirical rate of occasional Cloud
# Run cold-start blips.
#
# Note: a dispatcher 5xx that Strava successfully retries is invisible to
# this SLO (Strava's retry recovers it). Only a 5xx that survives all 3
# Strava retries = lost webhook from the user's perspective.

resource "google_monitoring_slo" "dispatcher_availability" {
  service             = google_monitoring_service.dispatcher.name
  slo_id              = "dispatcher-availability"
  display_name        = "Dispatcher availability — 99% over 30d"
  goal                = 0.99
  rolling_period_days = 30

  request_based_sli {
    good_total_ratio {
      bad_service_filter   = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.\"response_code_class\"=\"5xx\""
      total_service_filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\""
    }
  }
}

resource "google_monitoring_alert_policy" "slo_1_dispatcher_availability_fast_burn" {
  display_name = "SLO 1 (dispatcher availability) — fast burn (1h)"
  combiner     = "OR"

  conditions {
    display_name = "Fast burn: 14.4× rate over 1 hour"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.dispatcher_availability.name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 14.4
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    content   = <<-EOT
      The dispatcher availability SLO is burning fast. At the current rate
      the 30-day error budget will be exhausted in ~2 days.

      **Targets**: 99% of POST /webhook requests return < 500 over rolling 30d.
      **Error budget**: ~1.5-6 sustained 5xx/month at typical volume.

      **Investigate**:
      - Recent deploys on dispatcher
      - Strava API connectivity (token refresh failures, 401 chains)
      - Firestore read failures (allowlist check, token store)
      - Pub/Sub publish failures (downstream of dispatcher work)

      **Spec**: `docs/slo.md` SLO 1.
      **Triage**: `docs/runbooks/reading-traces.md` for trace inspection;
      `docs/runbooks/webhook-events-absent.md` for the related "no events
      arriving" story.
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "slo_1_dispatcher_availability_slow_burn" {
  display_name = "SLO 1 (dispatcher availability) — slow burn (6h)"
  combiner     = "OR"

  conditions {
    display_name = "Slow burn: 6× rate over 6 hours"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.dispatcher_availability.name}\", \"21600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 6.0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.slack_only_notification_channels

  documentation {
    content   = <<-EOT
      The dispatcher availability SLO is burning slowly — sustained mild
      degradation. Lower urgency than fast-burn; investigate next session.

      Same investigation steps as the fast-burn alert; see `docs/slo.md`
      SLO 1.
    EOT
    mime_type = "text/markdown"
  }
}

# ============================================================================
# SLO 5 — Apigateway latency (target: 95% under 1s over 30 days)
# ============================================================================
# SLI: % of /v1/* requests completing in < 1000ms.
#
# Different SLI shape than the availability SLOs: this uses `distribution_cut`
# rather than `good_total_ratio` because Cloud Run's request_latencies metric
# is a histogram (distribution), not a counter. The "good" fraction is
# requests whose duration falls within `range.max`.
#
# Filter excludes 5xx responses to avoid the "fast 500 makes the SLO look
# better" artifact: a request that errored fast doesn't validate the
# latency story, and 5xx is already covered by SLO 4 (availability). This
# follows the SRE Workbook recommendation to count latency only on
# successful requests.
#
# Same whole-service vs strict /v1/* imprecision as SLO 4 — Cloud Run's
# native metric doesn't carry path labels. /ready, /health, /api/auth/* are
# included; their typical latencies are sub-100ms which boosts the SLO
# slightly toward "more meeting target." Acceptable for the pilot.

resource "google_monitoring_slo" "apigateway_latency" {
  service             = google_monitoring_service.apigateway.name
  slo_id              = "apigateway-latency"
  display_name        = "Apigateway latency — 95% under 1s over 30d"
  goal                = 0.95
  rolling_period_days = 30

  request_based_sli {
    distribution_cut {
      distribution_filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\" metric.label.\"response_code_class\"!=\"5xx\""
      range {
        # Cloud Run request_latencies is reported in milliseconds.
        # 1000ms = 1 second; counts requests <= this as "good."
        max = 1000
      }
    }
  }
}

resource "google_monitoring_alert_policy" "slo_5_apigateway_latency_fast_burn" {
  display_name = "SLO 5 (apigateway latency) — fast burn (1h)"
  combiner     = "OR"

  conditions {
    display_name = "Fast burn: 14.4× rate over 1 hour"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_latency.name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 14.4
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    content   = <<-EOT
      The apigateway latency SLO is burning fast. Sustained slow responses
      are pushing /v1/* p95 above 1 second. At the current rate the 30-day
      error budget will be exhausted in ~2 days.

      **Targets**: 95% of `/v1/*` requests complete in < 1000ms over rolling 30d.
      **Error budget**: 5% of requests can be slow before the budget burns.

      **Investigate**:
      - Postgres query performance (look at
        `desirelines.io/postgres/query.duration` by operation label; the
        `list_routes` and `multi_sport_*` operations are typical hot spots)
      - Neon cold compute (postgres.session.acquire elevated → cold pool,
        first query slow)
      - Cloud Run cold-start frequency (high if traffic is bursty)
      - Recent code changes that added work to the request path

      **Spec**: `docs/slo.md` SLO 5.
      **Triage**: `docs/runbooks/reading-traces.md` slow-pattern table.
    EOT
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "slo_5_apigateway_latency_slow_burn" {
  display_name = "SLO 5 (apigateway latency) — slow burn (6h)"
  combiner     = "OR"

  conditions {
    display_name = "Slow burn: 6× rate over 6 hours"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_latency.name}\", \"21600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 6.0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.slack_only_notification_channels

  documentation {
    content   = <<-EOT
      The apigateway latency SLO is burning slowly — sustained mild
      latency degradation. Lower urgency than fast-burn; investigate
      next session.

      Same investigation steps as the fast-burn alert; see `docs/slo.md`
      SLO 5.
    EOT
    mime_type = "text/markdown"
  }
}
