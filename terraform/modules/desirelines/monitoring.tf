# ============================================================================
# GCP Monitoring Dashboard for Desirelines Production Observability
# ============================================================================
# This dashboard provides at-a-glance visibility into:
# - Dead Letter Queue health (critical early warning)
# - Cloud Run service performance and errors
# - PubSub message flow and backlogs
# - Data pipeline health (BigQuery & Storage)
# ============================================================================

resource "google_monitoring_dashboard" "desirelines_observability" {
  dashboard_json = jsonencode({
    displayName = "Desirelines ${title(var.environment)} - Production Observability"

    # Mosaic layout with 12-column grid
    mosaicLayout = {
      columns = 12

      tiles = [
        # ====================================================================
        # Section Header: Dead Letter Queues (CRITICAL) - Row 0
        # ====================================================================
        {
          width  = 12
          height = 2
          widget = {
            title = "🚨 Dead Letter Queues (Critical)"
            text = {
              content = "Messages in DLQ indicate pipeline failures. Should always be 0 in healthy system."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # BQ Inserter DLQ - Row 2, Left
        {
          yPos   = 2
          width  = 6
          height = 4
          widget = {
            title = "BQ Inserter DLQ Messages"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.bq_inserter_dlq.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 1
              }]
            }
          }
        },

        # Postgres Writer DLQ - Row 2, Right
        {
          xPos   = 6
          yPos   = 2
          width  = 6
          height = 4
          widget = {
            title = "PostgreSQL Writer DLQ Messages"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.postgres_writer_dlq.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 1
              }]
            }
          }
        },

        # ====================================================================
        # Section Header: Cloud Run Performance - Row 6
        # ====================================================================
        {
          yPos   = 6
          width  = 12
          height = 2
          widget = {
            title = "⚡ Cloud Run Performance"
            text = {
              content = "Monitor execution counts, error rates, and performance across all services:\n- **dispatcher** (webhook entry point)\n- **api_gateway** (web UI backend)\n- **bq_inserter** (BigQuery writer)\n- **postgres_writer** (PostgreSQL sync)"
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Service Request Counts - Row 8
        {
          yPos   = 8
          width  = 12
          height = 4
          widget = {
            title = "Service Requests (per minute)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["resource.labels.service_name"]
                      }
                    }
                  }
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "$${resource.labels.service_name}"
                }
              ]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Requests/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Service 4xx Errors - Row 12, Left
        {
          yPos   = 12
          width  = 6
          height = 4
          widget = {
            title = "Service 4xx Errors (client errors)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"4xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.labels.service_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.service_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Errors/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Service 5xx Errors - Row 12, Right
        {
          xPos   = 6
          yPos   = 12
          width  = 6
          height = 4
          widget = {
            title = "Service 5xx Errors (server errors)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.labels.service_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.service_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Errors/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 0.05
              }]
            }
          }
        },

        # Service Request Latency (P95) - Row 16, Full Width
        {
          yPos   = 16
          width  = 12
          height = 4
          widget = {
            title = "Service Request Latency P95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["resource.labels.service_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.service_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 5000
              }]
            }
          }
        },

        # Service Instance Count - Row 20
        {
          yPos   = 20
          width  = 12
          height = 4
          widget = {
            title = "Service Instance Count"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/container/instance_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.labels.service_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.service_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Instances"
                scale = "LINEAR"
              }
            }
          }
        },

        # ====================================================================
        # Section Header: PubSub Message Flow - Row 24
        # ====================================================================
        {
          yPos   = 24
          width  = 12
          height = 2
          widget = {
            title = "📨 PubSub Message Flow"
            text = {
              content = "Monitor message throughput and detect backlogs."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Messages Published - Row 26, Left
        {
          yPos   = 26
          width  = 6
          height = 4
          widget = {
            title = "Messages Published (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_topic\" AND resource.labels.topic_id=\"desirelines_activity_events\" AND metric.type=\"pubsub.googleapis.com/topic/send_request_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Unacked Messages - Row 26, Right
        {
          xPos   = 6
          yPos   = 26
          width  = 6
          height = 4
          widget = {
            title = "Unacked Messages (Backlog)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"(desirelines-.*-dlq|eventarc-.*)\") AND metric.type=\"pubsub.googleapis.com/subscription/num_unacked_messages_by_region\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.subscription_id"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.subscription_id}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 100
              }]
            }
          }
        },

        # Oldest Unacked Message Age - Row 30
        {
          yPos   = 30
          width  = 12
          height = 4
          widget = {
            title = "Oldest Unacked Message Age (seconds)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"(desirelines-.*-dlq|eventarc-.*)\") AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MAX"
                      crossSeriesReducer = "REDUCE_MAX"
                      groupByFields      = ["resource.subscription_id"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.subscription_id}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Seconds"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 300
              }]
            }
          }
        },

        # ====================================================================
        # Section Header: Storage & Data Pipeline - Row 34
        # ====================================================================
        {
          yPos   = 34
          width  = 12
          height = 2
          widget = {
            title = "💾 Storage & Data Pipeline"
            text = {
              content = "Monitor Cloud Storage operations and aggregation file health."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Storage Object Count - Row 36, Left
        {
          yPos   = 36
          width  = 6
          height = 4
          widget = {
            title = "Aggregation Files Count (all versions)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"gcs_bucket\" AND resource.labels.bucket_name=monitoring.regex.full_match(\".*desirelines-aggregation\") AND metric.type=\"storage.googleapis.com/storage/object_count\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.bucket_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.bucket_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Files"
                scale = "LINEAR"
              }
            }
          }
        },

        # Storage Total Bytes - Row 36, Right
        {
          xPos   = 6
          yPos   = 36
          width  = 6
          height = 4
          widget = {
            title = "Storage Total Size (MB)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"gcs_bucket\" AND resource.labels.bucket_name=monitoring.regex.full_match(\".*desirelines-aggregation\") AND metric.type=\"storage.googleapis.com/storage/total_bytes\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.bucket_name"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.bucket_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Megabytes"
                scale = "LINEAR"
              }
            }
          }
        }
      ]
    }
  })
}

# ============================================================================
# Notification Channels
# ============================================================================

# Email notification channel for alerts
resource "google_monitoring_notification_channel" "email_alerts" {
  for_each = var.developer_email != null ? toset([nonsensitive(var.developer_email)]) : toset([])

  display_name = "Desirelines ${title(var.environment)} - Developer Email"
  type         = "email"

  labels = {
    email_address = each.value
  }

  enabled = true
}

# ============================================================================
# Alerting Policies
# ============================================================================

# CRITICAL: DLQ Messages Detected (BQ Inserter)
resource "google_monitoring_alert_policy" "dlq_bq_inserter" {
  display_name = "🚨 DLQ: BQ Inserter Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: The BQ Inserter Dead Letter Queue has messages.

      This indicates that activities are failing to be inserted into BigQuery.

      **Action Required**:
      1. Check DLQ messages in PubSub console
      2. Review BQ Inserter function logs for errors
      3. Check BigQuery table schema for issues

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "BQ Inserter DLQ has messages"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.bq_inserter_dlq.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.developer_email != null ? [google_monitoring_notification_channel.email_alerts[nonsensitive(var.developer_email)].id] : []

  alert_strategy {
    auto_close = "1800s" # Auto-resolve after 30 minutes of no messages
  }
}

# HIGH: Service 4xx Error Rate (Client Errors)
resource "google_monitoring_alert_policy" "service_4xx_errors" {
  display_name = "⚠️ Cloud Run: High 4xx Error Rate"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM PRIORITY**: One or more Cloud Run services are experiencing high 4xx errors (>10%).

      4xx errors are client errors (bad requests, unauthorized, not found, etc.) and may indicate:
      - Malformed webhook payloads from Strava (dispatcher)
      - Invalid API requests (api_gateway)
      - Authentication issues

      **Monitored Services**:
      - desirelines-dispatcher (webhook entry point)
      - desirelines-api-gateway (web UI backend)
      - desirelines-bq-inserter (BigQuery writer)
      - desirelines-postgres-writer (PostgreSQL writer)

      **Action Required**:
      1. Check which service is affected in the dashboard
      2. Review service logs to see specific 4xx status codes
      3. For dispatcher: Check Strava webhook payload format
      4. For api_gateway: Check client requests and auth tokens

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Service 4xx error rate > 10%"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"4xx\""
      duration        = "300s" # 5 minutes to avoid transient errors
      comparison      = "COMPARISON_GT"
      threshold_value = 0.10 # 10% error rate (higher tolerance for client errors)

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  notification_channels = var.developer_email != null ? [google_monitoring_notification_channel.email_alerts[nonsensitive(var.developer_email)].id] : []

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
  }
}

# CRITICAL: Service 5xx Error Rate (Server Errors)
resource "google_monitoring_alert_policy" "service_5xx_errors" {
  display_name = "🚨 Cloud Run: 5xx Server Errors"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: One or more Cloud Run services are experiencing 5xx server errors (>2%).

      5xx errors indicate actual problems with our code or infrastructure:
      - Unhandled exceptions
      - Timeouts
      - Dependency failures (BigQuery, PostgreSQL, etc.)

      **Monitored Services**:
      - desirelines-dispatcher (webhook entry point)
      - desirelines-api-gateway (web UI backend)
      - desirelines-bq-inserter (BigQuery writer)
      - desirelines-postgres-writer (PostgreSQL writer)

      **Action Required**:
      1. Check which service is failing in the dashboard
      2. Review service logs for stack traces and error details
      3. Check for recent deployments or configuration changes
      4. For bq_inserter/postgres_writer: Check DLQ for failed messages
      5. Verify dependencies (BigQuery, PostgreSQL) are healthy

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Service 5xx error rate > 2%"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      duration        = "300s" # 5 minutes
      comparison      = "COMPARISON_GT"
      threshold_value = 0.02 # 2% error rate (strict for server errors)

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  notification_channels = var.developer_email != null ? [google_monitoring_notification_channel.email_alerts[nonsensitive(var.developer_email)].id] : []

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
  }
}

# HIGH: Message Backlog Too Old
resource "google_monitoring_alert_policy" "old_messages" {
  display_name = "⚠️ PubSub: Old Unacked Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH PRIORITY**: Messages are not being processed in a timely manner.

      Oldest unacked message is older than 5 minutes, indicating a processing backlog.

      **Action Required**:
      1. Check if functions are scaling properly
      2. Review function execution times for performance issues
      3. Check for function instance limits

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Oldest unacked message > 5 minutes"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"(desirelines-.*-dlq|eventarc-.*)\") AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
      duration        = "300s" # 5 minutes
      comparison      = "COMPARISON_GT"
      threshold_value = 300 # 5 minutes in seconds

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.subscription_id"]
      }
    }
  }

  notification_channels = var.developer_email != null ? [google_monitoring_notification_channel.email_alerts[nonsensitive(var.developer_email)].id] : []

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
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
    dlq_bq_inserter = google_monitoring_alert_policy.dlq_bq_inserter.id
    service_4xx     = google_monitoring_alert_policy.service_4xx_errors.id
    service_5xx     = google_monitoring_alert_policy.service_5xx_errors.id
    old_messages    = google_monitoring_alert_policy.old_messages.id
  }
}
