# ============================================================================
# Monitoring module orchestration
# ============================================================================
# This file is the orchestration hub for the monitoring module. The bulk
# of resources live in focused siblings:
#
#   - dashboards.tf        Cloud Monitoring dashboard
#   - alerts.tf            Static-threshold alert policies (pipeline
#                          health: DLQ + non-SLO 5xx + PubSub backlog;
#                          security: per-response-code anomaly signals;
#                          OTel application-metric alerts)
#   - uptime_checks.tf     Synthetic HTTPS probes + alerts
#   - readiness_probes.tf  Cloud Scheduler-driven /ready probes + alerts
#   - slos.tf              `google_monitoring_slo` + burn-rate alerts
#
# What stays here:
#   - Notification channels (email + Slack composite locals)
#   - Top-level outputs (dashboard URL + alert policy IDs)
#
# Custom OTel metrics use the prefix `workload.googleapis.com/desirelines.io/`
# (default of opentelemetry-operations-go/exporter/metric in provider.go).
# ============================================================================

# ============================================================================
# Notification Channels
# ============================================================================
# Notification channels are conditional: created only if developer_email is set.
# Alert policies below always exist (visible in GCP Console) but only send
# notifications if a channel is configured. Uses count instead of for_each
# because developer_email is marked sensitive (for_each keys appear in state).

# Email notification channel for alerts
resource "google_monitoring_notification_channel" "email_alerts" {
  count = var.developer_email != null ? 1 : 0

  display_name = "Desirelines ${title(var.environment)} - Developer Email"
  type         = "email"

  labels = {
    email_address = var.developer_email
  }

  enabled = true
}

# Combined notification channel list used by every alert policy below. The
# Slack channel is created outside Terraform (via GCP Console OAuth) so the
# auth token never enters state; we just reference its ID. Email is kept
# as a backup — both fire in parallel so nothing is missed if Slack is muted.
#
# `slack_only_notification_channels` is the lower-urgency variant used by
# slow-burn SLO alerts in slos.tf — Slack only, no email — so the inbox
# isn't flooded by sustained-mild-degradation alerts.
locals {
  notification_channels = concat(
    google_monitoring_notification_channel.email_alerts[*].id,
    var.slack_notification_channel_id != null ? [var.slack_notification_channel_id] : [],
  )
  slack_only_notification_channels = (
    var.slack_notification_channel_id != null
    ? [var.slack_notification_channel_id]
    : []
  )
}

# ============================================================================
# Unknown Strava sport_type — log-based metric + alert
# ============================================================================
# Surfaces sport_type values that Strava added upstream before we registered
# them in schemas/sports/sport_types.json. apigateway (Go) and stravapipe
# (Python) both emit a structured WARNING log
#   "Unknown Strava sport_type detected"
# from their sport-config layer on first sighting (deduped per process); the
# unmapped activity is bucketed to the "other" category so it still renders
# in the UI. This metric counts those WARNINGs and the alert pages on the
# first one so an operator can extend the registry.
#
# Filter keys on the structured `jsonPayload.event="unknown_sport_type"` field,
# NOT the human-readable log message, so a reworded message can't silently break
# this metric. The `event` value is the contract: both runtimes pin it with a
# contract test (Go apigateway and Python stravapipe sport-config layers). If
# that event value ever changes, update it here in lockstep — otherwise the
# alert silently goes dark. See the inline comment on the filter below.
#
# Not gated on enable_application_metric_alerts: log-based metric descriptors
# are created with the Terraform resource itself (no app emission required),
# so the alert can bind on the first apply without the "metric does not exist
# yet" 404 that gates the OTel-based alerts.
resource "google_logging_metric" "unknown_sport_type" {
  name        = "${var.project_name}_${var.environment}_unknown_sport_type"
  description = "Strava sport_type values seen by apigateway/stravapipe that have no mapping in schemas/sports/sport_types.json. Each datapoint is one first-sighting WARNING; per-process dedup means the count tracks distinct unknown types observed (not raw activity count)."

  # Keyed on the structured `event` field, NOT the human-readable message — so a
  # reworded message can't silently break this metric (the message is duplicated
  # across two runtimes, doubling the drift risk). Both emitters set
  # jsonPayload.event="unknown_sport_type": Go slog attr (apigateway
  # config/sport_config.go unknownSportLogEvent), Python json_fields (stravapipe
  # config/sport_config.py UNKNOWN_SPORT_LOG_EVENT). Each side pins it with a
  # contract test. `severity=WARNING` + cloud_run_revision keep an unrelated
  # emitter of the same event value from false-positiving.
  filter = <<-EOT
    resource.type="cloud_run_revision"
    severity=WARNING
    jsonPayload.event="unknown_sport_type"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "unmapped_sport_type"
      value_type  = "STRING"
      description = "The Strava sport_type value that fell through to the 'other' bucket."
    }
    labels {
      key         = "service"
      value_type  = "STRING"
      description = "Cloud Run service that emitted the warning (apigateway or stravapipe-*)."
    }
  }

  # Extract the unmapped sport name and the Cloud Run service name so the
  # alert message names the specific sport without requiring a log dive.
  label_extractors = {
    "unmapped_sport_type" = "EXTRACT(jsonPayload.unmapped_sport_type)"
    "service"             = "EXTRACT(resource.labels.service_name)"
  }
}

# HIGH (but volume-bounded): A previously-unmapped Strava sport_type just
# landed in production. The first occurrence in a given Cloud Run instance
# emits one WARNING (per-process dedup); subsequent activities of the same
# type are silently re-bucketed into "other" until the instance recycles.
# That makes the alert exactly the signal we want: page once when a new
# upstream sport appears, then go quiet so the operator can register it
# without inbox noise.
#
# Action on fire: open the alert, read the `unmapped_sport_type` label,
# add the value to the appropriate category in schemas/sports/sport_types.json,
# run `just sync-schemas && just verify-schemas`, ship.
resource "google_monitoring_alert_policy" "unknown_sport_type_detected" {
  display_name = "⚠️ Strava sport_type detected with no registry mapping"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH**: apigateway or stravapipe just saw a Strava `sport_type` value
      that has no entry in `schemas/sports/sport_types.json`. The activity
      was bucketed into the "other" category so the user can still see it in
      the UI, but until the registry is updated all future activities of
      this type will also land in "other" instead of their proper bucket.

      **Where it came from**: the alert's `unmapped_sport_type` label names
      the exact Strava enum value (e.g., `HighIntensityIntervalTraining`).

      **Action**:
      1. Cross-check against Strava's current `SportType` enum:
         `just check-upstream-sports` (or
         https://developers.strava.com/swagger/swagger.json → `SportType`).
      2. Add the value to the most fitting category in
         `schemas/sports/sport_types.json`. If none fits, leave it in
         "other" — that's a valid permanent state.
      3. Run `just sync-schemas && just verify-schemas` and open a PR.
      4. Once deployed, the alert auto-closes after 1h with no fresh firings.

      Dedup note: each Cloud Run instance only emits one WARNING per
      unmapped type. Quiet alerts don't mean the unmapped type stopped
      arriving — it means the instance hasn't recycled. Check the GCP
      "other" category counts (apigateway dashboard) to see ongoing
      volume.
    EOT
  }

  conditions {
    display_name = "Unknown sport_type detected at least once in 5m"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.unknown_sport_type.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.unmapped_sport_type"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    # Per-process dedup means a recurring unmapped type produces sparse,
    # bursty datapoints (one per cold start). 1h auto-close keeps the alert
    # actionable without re-firing forever on the same gap-in-registry.
    auto_close = "3600s"
  }
}

# Output the dashboard URL for easy access
output "monitoring_dashboard_url" {
  description = "URL to the GCP Monitoring Dashboard"
  value       = "https://console.cloud.google.com/monitoring/dashboards/custom/${google_monitoring_dashboard.desirelines_observability.id}"
}

# Output alert policy IDs
output "alert_policy_ids" {
  description = "IDs of created alert policies"
  value = {
    dlq_bq_inserter               = google_monitoring_alert_policy.dlq_bq_inserter.id
    dlq_postgres_writer           = google_monitoring_alert_policy.dlq_postgres_writer.id
    service_5xx                   = google_monitoring_alert_policy.service_5xx_errors.id
    apigateway_auth_failure_surge = google_monitoring_alert_policy.apigateway_auth_failure_surge.id
    apigateway_not_found_surge    = google_monitoring_alert_policy.apigateway_not_found_surge.id
    apigateway_rate_limited_surge = google_monitoring_alert_policy.apigateway_rate_limited_surge.id
    dispatcher_bad_request_surge  = google_monitoring_alert_policy.dispatcher_bad_request_surge.id
    old_messages                  = google_monitoring_alert_policy.old_messages.id
    apigateway_uptime             = google_monitoring_alert_policy.apigateway_uptime.id
    apigateway_readiness_failing  = google_monitoring_alert_policy.apigateway_readiness_failing.id
    python_readiness_failing      = google_monitoring_alert_policy.python_readiness_failing.id
    frontend_uptime               = google_monitoring_alert_policy.frontend_uptime.id
    postgres_pool_exhaustion      = one(google_monitoring_alert_policy.postgres_pool_exhaustion[*].id)
    strava_api_latency            = one(google_monitoring_alert_policy.strava_api_latency[*].id)
    http_request_latency          = one(google_monitoring_alert_policy.http_request_latency[*].id)
    postgres_query_latency        = one(google_monitoring_alert_policy.postgres_query_latency[*].id)
    firestore_operation_latency   = one(google_monitoring_alert_policy.firestore_operation_latency[*].id)
    pubsub_publish_latency        = one(google_monitoring_alert_policy.pubsub_publish_latency[*].id)
    webhook_events_absent         = one(google_monitoring_alert_policy.webhook_events_absent[*].id)
    webhook_owner_check_orphan    = one(google_monitoring_alert_policy.webhook_owner_check_orphan[*].id)
    webhook_owner_check_error     = one(google_monitoring_alert_policy.webhook_owner_check_error[*].id)
    unknown_sport_type_detected   = google_monitoring_alert_policy.unknown_sport_type_detected.id
  }
}
