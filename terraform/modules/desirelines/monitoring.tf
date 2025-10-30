# ============================================================================
# GCP Monitoring Dashboard for Desirelines Production Observability
# ============================================================================
# This dashboard provides at-a-glance visibility into:
# - Dead Letter Queue health (critical early warning)
# - Cloud Function performance and errors
# - PubSub message flow and backlogs
# - Data pipeline health (BigQuery & Storage)
#
# Related: docs/planning/tasks/in-progress/monitoring-dashboard.md
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
          xPos   = 0
          yPos   = 0
          width  = 12
          height = 2
          widget = {
            title = "🚨 Dead Letter Queues (Critical)"
            text = {
              content = "Messages in DLQ indicate pipeline failures. Should always be 0 in healthy system."
              format  = "MARKDOWN"
            }
          }
        },

        # BQ Inserter DLQ - Row 2, Left
        {
          xPos   = 0
          yPos   = 2
          width  = 6
          height = 4
          widget = {
            title = "BQ Inserter DLQ Messages"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"desirelines-bq-inserter-dlq\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 1
                # direction = "ABOVE"
                # label removed
              }]
            }
          }
        },

        # Aggregator DLQ - Row 2, Right
        {
          xPos   = 6
          yPos   = 2
          width  = 6
          height = 4
          widget = {
            title = "Aggregator DLQ Messages"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"desirelines-aggregator-dlq\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 1
                # direction = "ABOVE"
                # label removed
              }]
            }
          }
        },

        # ====================================================================
        # Section Header: Cloud Functions Performance - Row 6
        # ====================================================================
        {
          xPos   = 0
          yPos   = 6
          width  = 12
          height = 2
          widget = {
            title = "⚡ Cloud Functions Performance"
            text = {
              content = "Monitor execution counts, error rates, and performance across all functions:\n- **dispatcher** (webhook entry point)\n- **api_gateway** (web UI backend)\n- **bq_inserter** (BigQuery writer)\n- **aggregator** (summary aggregator)"
              format  = "MARKDOWN"
            }
          }
        },

        # Function Execution Counts - Row 8
        {
          xPos   = 0
          yPos   = 8
          width  = 12
          height = 4
          widget = {
            title = "Function Executions (per minute)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["resource.function_name"]
                      }
                    }
                  }
                  plotType       = "LINE"
                  legendTemplate = "$${resource.labels.function_name}"
                }
              ]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Executions/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Function 4xx Errors - Row 12, Left
        {
          xPos   = 0
          yPos   = 12
          width  = 6
          height = 4
          widget = {
            title = "Function 4xx Errors (client errors)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status=monitoring.regex.full_match(\"4..\") "
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.function_name"]
                    }
                  }
                }
                plotType       = "LINE"
                legendTemplate = "$${resource.labels.function_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Errors/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Function 5xx Errors - Row 12, Right
        {
          xPos   = 6
          yPos   = 12
          width  = 6
          height = 4
          widget = {
            title = "Function 5xx Errors (server errors)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status=monitoring.regex.full_match(\"5..\") "
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.function_name"]
                    }
                  }
                }
                plotType       = "LINE"
                legendTemplate = "$${resource.labels.function_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Errors/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 0.05
                # 5xx should be rare
              }]
            }
          }
        },

        # Function Execution Times (P95) - Row 16, Full Width
        {
          xPos   = 0
          yPos   = 16
          width  = 12
          height = 4
          widget = {
            title = "Function Execution Time P95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_times\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["resource.function_name"]
                    }
                  }
                }
                plotType       = "LINE"
                legendTemplate = "$${resource.labels.function_name}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 5000
                # direction = "ABOVE"
                # label removed
              }]
            }
          }
        },

        # Function Active Instances - Row 20
        {
          xPos   = 0
          yPos   = 20
          width  = 12
          height = 4
          widget = {
            title = "Function Active Instances"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/active_instances\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_MEAN"
                      groupByFields      = ["resource.function_name"]
                    }
                  }
                }
                plotType       = "LINE"
                legendTemplate = "$${resource.labels.function_name}"
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
          xPos   = 0
          yPos   = 24
          width  = 12
          height = 2
          widget = {
            title = "📨 PubSub Message Flow"
            text = {
              content = "Monitor message throughput and detect backlogs."
              format  = "MARKDOWN"
            }
          }
        },

        # Messages Published - Row 26, Left
        {
          xPos   = 0
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
                plotType = "LINE"
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
                legendTemplate = "$${resource.labels.subscription_id}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Messages"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 100
                # direction = "ABOVE"
                # label removed
              }]
            }
          }
        },

        # Oldest Unacked Message Age - Row 30
        {
          xPos   = 0
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
                legendTemplate = "$${resource.labels.subscription_id}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Seconds"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 300
                # direction = "ABOVE"
                # label removed
              }]
            }
          }
        },

        # ====================================================================
        # Section Header: Storage & Data Pipeline - Row 34
        # ====================================================================
        {
          xPos   = 0
          yPos   = 34
          width  = 12
          height = 2
          widget = {
            title = "💾 Storage & Data Pipeline"
            text = {
              content = "Monitor Cloud Storage operations and aggregation file health."
              format  = "MARKDOWN"
            }
          }
        },

        # Storage Object Count - Row 36, Left
        {
          xPos   = 0
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
  count = var.developer_email != null ? 1 : 0

  display_name = "Desirelines ${title(var.environment)} - Developer Email"
  type         = "email"

  labels = {
    email_address = var.developer_email
  }

  enabled = true
}

# ============================================================================
# Alerting Policies
# ============================================================================

# CRITICAL: DLQ Messages Detected (BQ Inserter)
resource "google_monitoring_alert_policy" "dlq_bq_inserter" {
  count = var.developer_email != null ? 1 : 0

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
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"desirelines-bq-inserter-dlq\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts[0].id]

  alert_strategy {
    auto_close = "1800s" # Auto-resolve after 30 minutes of no messages
  }
}

# CRITICAL: DLQ Messages Detected (Aggregator)
resource "google_monitoring_alert_policy" "dlq_aggregator" {
  count = var.developer_email != null ? 1 : 0

  display_name = "🚨 DLQ: Aggregator Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: The Aggregator Dead Letter Queue has messages.

      This indicates that activities are failing to be aggregated.

      **Action Required**:
      1. Check DLQ messages in PubSub console
      2. Review Aggregator function logs for errors
      3. Check Cloud Storage bucket permissions

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Aggregator DLQ has messages"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"desirelines-aggregator-dlq\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts[0].id]

  alert_strategy {
    auto_close = "1800s" # Auto-resolve after 30 minutes of no messages
  }
}

# HIGH: Function 4xx Error Rate (Client Errors)
resource "google_monitoring_alert_policy" "function_4xx_errors" {
  count = var.developer_email != null ? 1 : 0

  display_name = "⚠️ Cloud Functions: High 4xx Error Rate"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM PRIORITY**: One or more Cloud Functions are experiencing high 4xx errors (>10%).

      4xx errors are client errors (bad requests, unauthorized, not found, etc.) and may indicate:
      - Malformed webhook payloads from Strava (dispatcher)
      - Invalid API requests (api_gateway)
      - Authentication issues

      **Monitored Functions**:
      - desirelines_dispatcher (webhook entry point)
      - desirelines_api_gateway (web UI backend)
      - desirelines_bq_inserter (BigQuery writer)
      - desirelines_aggregator (summary aggregator)

      **Action Required**:
      1. Check which function is affected in the dashboard
      2. Review function logs to see specific 4xx status codes
      3. For dispatcher: Check Strava webhook payload format
      4. For api_gateway: Check client requests and auth tokens

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Function 4xx error rate > 10%"

    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status=monitoring.regex.full_match(\"4..\")"
      duration        = "300s" # 5 minutes to avoid transient errors
      comparison      = "COMPARISON_GT"
      threshold_value = 0.10 # 10% error rate (higher tolerance for client errors)

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.function_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts[0].id]

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
  }
}

# CRITICAL: Function 5xx Error Rate (Server Errors)
resource "google_monitoring_alert_policy" "function_5xx_errors" {
  count = var.developer_email != null ? 1 : 0

  display_name = "🚨 Cloud Functions: 5xx Server Errors"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: One or more Cloud Functions are experiencing 5xx server errors (>2%).

      5xx errors indicate actual problems with our code or infrastructure:
      - Unhandled exceptions
      - Timeouts
      - Dependency failures (BigQuery, Cloud Storage, etc.)

      **Monitored Functions**:
      - desirelines_dispatcher (webhook entry point)
      - desirelines_api_gateway (web UI backend)
      - desirelines_bq_inserter (BigQuery writer)
      - desirelines_aggregator (summary aggregator)

      **Action Required**:
      1. Check which function is failing in the dashboard
      2. Review function logs for stack traces and error details
      3. Check for recent deployments or configuration changes
      4. For bq_inserter/aggregator: Check DLQ for failed messages
      5. Verify dependencies (BigQuery, Cloud Storage) are healthy

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Function 5xx error rate > 2%"

    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND resource.labels.function_name=monitoring.regex.full_match(\"desirelines.*\") AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status=monitoring.regex.full_match(\"5..\")"
      duration        = "300s" # 5 minutes
      comparison      = "COMPARISON_GT"
      threshold_value = 0.02 # 2% error rate (strict for server errors)

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.function_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts[0].id]

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
  }
}

# HIGH: Message Backlog Too Old
resource "google_monitoring_alert_policy" "old_messages" {
  count = var.developer_email != null ? 1 : 0

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

  notification_channels = [google_monitoring_notification_channel.email_alerts[0].id]

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
  value = var.developer_email != null ? {
    dlq_bq_inserter = google_monitoring_alert_policy.dlq_bq_inserter[0].id
    dlq_aggregator  = google_monitoring_alert_policy.dlq_aggregator[0].id
    function_4xx    = google_monitoring_alert_policy.function_4xx_errors[0].id
    function_5xx    = google_monitoring_alert_policy.function_5xx_errors[0].id
    old_messages    = google_monitoring_alert_policy.old_messages[0].id
  } : {}
}
