# ============================================================================
# Monitoring module orchestration
# ============================================================================
# This file is the orchestration hub for the monitoring module. The bulk
# of resources live in focused siblings:
#
#   - dashboards.tf        Cloud Monitoring dashboard
#   - alerts.tf            Static-threshold alert policies (DLQ, 4xx/5xx,
#                          PubSub backlog, OTel application metrics)
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
  }
}
