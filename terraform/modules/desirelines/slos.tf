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
# Pilot: SLO 4 (apigateway availability) only. Once validated in dev,
# SLOs 1, 5 (Cloud Run availability/latency) follow the same pattern;
# SLOs 2, 3 (Pub/Sub DLQ ratio + custom freshness histogram) are MQL-based
# alerts rather than google_monitoring_slo resources, since they target
# non-Cloud-Run signals.
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
