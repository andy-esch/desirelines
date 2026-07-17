# ============================================================================
# Uptime Checks + their alerts
# ============================================================================
# Two synthetic HTTPS probes against externally-reachable URLs (apigateway
# `/api/health` via Firebase Hosting + frontend root). These catch outages
# that don't surface as Cloud Run 4xx/5xx — Firebase Hosting down, DNS
# issue, SSL expiry, full-stack down.
#
# Alerts kept co-located with their probes because the alert filters
# reference each check's `uptime_check_id`; splitting would force a
# cross-file lookup for what is really one cohesive unit.
# ============================================================================

# Two synthetic probes against externally-reachable URLs. These catch outages
# that don't show up as 4xx/5xx from Cloud Run (e.g., Firebase Hosting is down,
# DNS issue, SSL expiry).
#
# Cadence: 15 minutes (the GCP-supported maximum). For this personal project,
# we want Cloud Run to be allowed to scale to zero between checks — at 60s
# fan-out across ~6 regions, the service is pinged ~360 times/hour and never
# gets to idle. /api/health is now liveness-only (no DB ping), so the cost
# concern is Cloud Run wakeups rather than Neon compute. /api/ready is
# probed separately on its own hourly Cloud Scheduler cadence (below).

resource "google_monitoring_uptime_check_config" "apigateway_health" {
  display_name = "Desirelines ${title(var.environment)} - API Gateway /api/health"
  timeout      = "10s"
  period       = "900s" # 15 min — GCP's max uptime-check cadence

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.gcp_project_id
      host       = "${var.project_name}-${var.environment}.web.app"
    }
  }
}

resource "google_monitoring_uptime_check_config" "frontend_root" {
  display_name = "Desirelines ${title(var.environment)} - Frontend root"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.gcp_project_id
      host       = "${var.project_name}-${var.environment}.web.app"
    }
  }
}

# Alert when the uptime check is failing in ≥2 probe regions for ≥120s. The
# "count false" reducer over the alignment window is the documented pattern
# for uptime alerts. With the 15-min probe cadence (see uptime check above),
# detection latency is up to ~15 min from the start of an outage plus the
# 120s confirmation window — acceptable since the underlying probe is for
# Cloud Run / Firebase Hosting / DNS / SSL outages, where 5xx alerts and
# Postgres-query-latency alerts cover faster paths.
#
# Why threshold_value = 1 (not 0):
# REDUCE_COUNT_FALSE grouped by project_id collapses all probe regions into a
# single "number of regions currently failing" series. Uptime checks fan out
# from ~6 regions, and single-region transient failures (network blips, BGP
# flaps) are a well-known noise source — GCP's own docs recommend requiring
# multi-region failure to page. `> 1` fires when ≥2 regions fail simultaneously,
# which is the canonical signal for "the service is actually down" rather than
# "one probe region had a bad cycle."
resource "google_monitoring_alert_policy" "apigateway_uptime" {
  display_name = "🚨 Uptime: API Gateway /api/health failing"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/apigateway-uptime-failing.md

      **CRITICAL**: apigateway `/api/health` uptime check is failing across
      multiple probe regions. Note that the underlying probe runs every 15
      minutes, so detection of an outage may lag by up to ~17 minutes.

      Likely causes:
      - Cloud Run revision crashed or failed to start
      - Firebase Hosting rewrite (`/api/*` → Cloud Run) misconfigured
      - DNS/SSL issue on the hosting site

      **Action**: check the Cloud Run revision's logs and the Firebase Hosting rewrite rules.
    EOT
  }

  conditions {
    display_name = "apigateway /api/health failing"

    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.apigateway_health.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.project_id"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

resource "google_monitoring_alert_policy" "frontend_uptime" {
  display_name = "🚨 Uptime: Frontend root failing"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/frontend-uptime-failing.md

      **CRITICAL**: Firebase Hosting frontend uptime check has failed for ≥2 minutes.

      Likely causes:
      - Firebase Hosting deployment mid-flight or rolled back
      - DNS/SSL issue on `${var.project_name}-${var.environment}.web.app`

      **Action**: check Firebase Hosting deploy history in the Console.
    EOT
  }

  conditions {
    display_name = "Frontend root failing"

    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.frontend_root.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.project_id"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}
