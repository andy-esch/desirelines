# ============================================================================
# GCP Monitoring Dashboard for Desirelines Production Observability
# ============================================================================
# This dashboard provides at-a-glance visibility into:
# - Dead Letter Queue health (critical early warning)
# - Cloud Run service performance and errors
# - PubSub message flow and backlogs
# - Data pipeline health (BigQuery & PostgreSQL)
# Custom OTel metrics use the prefix `workload.googleapis.com/desirelines.io/`
# (default of opentelemetry-operations-go/exporter/metric in provider.go).
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
                    filter = "resource.type=\"pubsub_topic\" AND resource.labels.topic_id=\"${google_pubsub_topic.activity_events.name}\" AND metric.type=\"pubsub.googleapis.com/topic/send_request_count\""
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
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"pubsub.googleapis.com/subscription/num_unacked_messages_by_region\""
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
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
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
        # Section Header: Cloud Run Resource Utilization - Row 34
        # ====================================================================
        {
          yPos   = 34
          width  = 12
          height = 2
          widget = {
            title = "Cloud Run Resource Utilization"
            text = {
              content = "CPU and memory usage across services. Helps identify resource constraints and right-size allocations."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # CPU Utilization - Row 36, Left
        {
          yPos   = 36
          width  = 6
          height = 4
          widget = {
            title = "CPU Utilization (%)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/container/cpu/utilizations\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MEAN"
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
                label = "Utilization"
                scale = "LINEAR"
              }
            }
          }
        },

        # Memory Utilization - Row 36, Right
        {
          xPos   = 6
          yPos   = 36
          width  = 6
          height = 4
          widget = {
            title = "Memory Utilization (%)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/container/memory/utilizations\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MEAN"
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
                label = "Utilization"
                scale = "LINEAR"
              }
            }
          }
        },

        # Startup Latency - Row 40
        {
          yPos   = 40
          width  = 12
          height = 4
          widget = {
            title = "Container Startup Latency (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/container/startup_latencies\""
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
            }
          }
        },

        # ====================================================================
        # Section Header: PubSub Delivery Performance - Row 44
        # ====================================================================
        {
          yPos   = 44
          width  = 12
          height = 2
          widget = {
            title = "PubSub Push Delivery Performance"
            text = {
              content = "How quickly and reliably PubSub push subscriptions are delivering to Cloud Run services."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Push Delivery Latency - Row 46, Left
        {
          yPos   = 46
          width  = 6
          height = 4
          widget = {
            title = "Push Delivery Latency P95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"pubsub.googleapis.com/subscription/push_request_latencies\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["resource.labels.subscription_id"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${resource.labels.subscription_id}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
            }
          }
        },

        # Push Delivery Results - Row 46, Right
        {
          xPos   = 6
          yPos   = 46
          width  = 6
          height = 4
          widget = {
            title = "Push Delivery Results (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"pubsub.googleapis.com/subscription/push_request_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.labels.response_class"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.response_class}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Requests/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # ====================================================================
        # Section Header: Application Metrics (OTel) - Row 50
        # ====================================================================
        {
          yPos   = 50
          width  = 12
          height = 2
          widget = {
            title = "Application Metrics (OTel)"
            text = {
              content = "Custom application metrics exported via OpenTelemetry SDK to GCP Cloud Monitoring. Shows external dependency latency and business-level counters."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Strava API Latency - Row 52, Left
        {
          yPos   = 52
          width  = 6
          height = 4
          widget = {
            title = "Strava API Latency (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/strava/api.duration\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["metric.labels.operation"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.operation}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
            }
          }
        },

        # PostgreSQL Query Latency - Row 52, Right
        {
          xPos   = 6
          yPos   = 52
          width  = 6
          height = 4
          widget = {
            title = "PostgreSQL Query Latency (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/postgres/query.duration\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["metric.labels.operation"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.operation}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
            }
          }
        },

        # BigQuery Operation Latency - Row 56, Left
        {
          yPos   = 56
          width  = 6
          height = 4
          widget = {
            title = "BigQuery Operation Latency (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/bigquery/operation.duration\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["metric.labels.operation"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.operation}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
                scale = "LINEAR"
              }
            }
          }
        },

        # Webhook Events Counter - Row 56, Right
        {
          xPos   = 6
          yPos   = 56
          width  = 6
          height = 4
          widget = {
            title = "Webhook Events (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/events\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.labels.aspect_type"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.aspect_type}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Connection Pool Gauge - Row 60
        {
          yPos   = 60
          width  = 12
          height = 4
          widget = {
            title = "PostgreSQL Connection Pool (API Gateway)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/postgres/pool.connections\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.labels.state"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.state}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Connections"
                scale = "LINEAR"
              }
            }
          }
        },

        # Webhook Owner Allowlist Check - Row 64
        # Plots the four owner-check outcomes:
        #   allowed  — happy path; matches the webhook/events rate
        #   stray    — not allowlisted; expected, ack'd silently
        #   orphan   — allowlisted but no Firestore tokens; alerts
        #   error    — allowlist read failed; alerts at >1/min
        {
          yPos   = 64
          width  = 12
          height = 4
          widget = {
            title = "Webhook Owner Check Outcomes (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/owner_check\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.labels.result"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.result}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
            }
          }
        },

        # Postgres Writer Operation Latency (P95) - Row 68, Full Width
        # Sister metric to postgres/query.duration (apigateway side); this
        # one comes from the postgres-writer service. Operation labels:
        # insert, activities_insert, update_metadata, delete.
        # `activities_insert` surfaces the Neon cold-compute signal:
        # warm-path ~180ms, cold ~1s+.
        {
          yPos   = 68
          width  = 12
          height = 4
          widget = {
            title = "Postgres Writer Operation Latency (P95) by operation"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/postgres/operation.duration\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                      groupByFields      = ["metric.labels.operation"]
                    }
                  }
                }
                plotType       = "LINE"
                targetAxis     = "Y1"
                legendTemplate = "$${metric.labels.operation}"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Milliseconds"
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
locals {
  notification_channels = concat(
    google_monitoring_notification_channel.email_alerts[*].id,
    var.slack_notification_channel_id != null ? [var.slack_notification_channel_id] : [],
  )
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

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "1800s" # Auto-resolve after 30 minutes of no messages
  }
}

# CRITICAL: DLQ Messages Detected (PostgreSQL Writer)
resource "google_monitoring_alert_policy" "dlq_postgres_writer" {
  display_name = "DLQ: PostgreSQL Writer Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: The PostgreSQL Writer Dead Letter Queue has messages.

      This indicates that activities are failing to be written to PostgreSQL.

      **Action Required**:
      1. Check DLQ messages in PubSub console
      2. Review PostgreSQL Writer service logs for errors
      3. Check PostgreSQL connectivity and schema issues

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "PostgreSQL Writer DLQ has messages"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.postgres_writer_dlq.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.notification_channels

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

  notification_channels = local.notification_channels

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

  notification_channels = local.notification_channels

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
      1. Check if Cloud Run services are scaling properly
      2. Review service logs for performance issues
      3. Check for instance limits or resource constraints

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Oldest unacked message > 5 minutes"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
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

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s" # Auto-resolve after 1 hour
  }
}

# ============================================================================
# Uptime Checks
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

# ============================================================================
# Hourly readiness check (Cloud Scheduler → /api/ready)
# ============================================================================
# Why this isn't a second uptime check: GCP uptime checks fan out across ~6
# probe regions and have a max cadence of 15 min. We want a single, hourly,
# DB-touching probe — Cloud Scheduler hits /api/ready from one location at the
# desired cadence, so Neon's compute can stay suspended between probes.
resource "google_cloud_scheduler_job" "apigateway_readiness" {
  name        = "${var.project_name}-${var.environment}-apigateway-readiness"
  description = "DB-touching readiness probe for apigateway (default hourly)"
  schedule    = var.readiness_probe_schedule
  time_zone   = "UTC"
  region      = var.gcp_region

  retry_config {
    retry_count = 0 # one shot; failure is the signal
  }

  http_target {
    http_method = "GET"
    uri         = "https://${var.project_name}-${var.environment}.web.app/api/ready"
    # No oidc_token / oauth_token: apigateway is fronted by Firebase Hosting
    # with allUsers run.invoker, so the call is unauthenticated like a real
    # user request. If the apigateway is later locked down, switch to an
    # oidc_token block referencing the scheduler service account.
  }

  depends_on = [google_project_service.required_apis]
}

# Count failed executions of the readiness Scheduler job
resource "google_logging_metric" "apigateway_readiness_failures" {
  name        = "${var.project_name}_${var.environment}_apigateway_readiness_failures"
  description = "Cloud Scheduler readiness probe responses that aren't 2xx"
  filter      = <<-EOT
    resource.type="cloud_scheduler_job"
    resource.labels.job_id="${google_cloud_scheduler_job.apigateway_readiness.name}"
    httpRequest.status>=400
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "apigateway_readiness_failing" {
  display_name = "🚨 apigateway /api/ready failing"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH**: 3 consecutive hourly readiness probes against
      `/api/ready` have failed in the last 4 hours. This typically means
      Postgres (Neon) is down, the connection pool is misconfigured, or
      apigateway has a bug in the readiness handler.

      **Action**:
      1. Check Neon dashboard — is the compute suspended? Down?
      2. Check apigateway logs for `Database health check failed`. Lines
         ending in `, retrying` are transient cold-start spikes that
         recovered on the second attempt — they don't indicate failure
         unless followed by a `Database health check failed` line for the
         same probe.
      3. Test the endpoint directly: `curl https://${var.project_name}-${var.environment}.web.app/api/ready`.
    EOT
  }

  conditions {
    display_name = "Readiness probe failures ≥ 3 in 4h"
    condition_threshold {
      filter          = "resource.type=\"cloud_scheduler_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.apigateway_readiness_failures.name}\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 2 # > 2 means ≥3 failures
      aggregations {
        alignment_period   = "14400s" # 4 hours
        per_series_aligner = "ALIGN_SUM"
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

# ============================================================================
# Hourly readiness checks for Python Cloud Run services
# ============================================================================
# Three private (INGRESS_TRAFFIC_INTERNAL_ONLY) Python services expose
# /ready endpoints with dependency probes. Cloud Scheduler hits each one on
# the same hourly cadence as apigateway_readiness, sharing
# var.readiness_probe_schedule so the postgres-writer probe lands inside
# apigateway's Neon compute wake window — two probes during one wake costs
# the same as one probe.
#
# Auth differs from apigateway: those services aren't fronted by Firebase
# Hosting, so the scheduler must present an OIDC token signed by a
# dedicated SA that holds roles/run.invoker on each target.
#
# Adding a fourth Python service later: add one entry to
# local.python_readiness_targets and re-apply — the for_each on IAM and
# scheduler resources, plus the keys()-interpolated regex on the shared
# metric, all derive from that single map. No new alert resource. The only
# manual step is adding a runbook bullet in the alert documentation under
# "Likely causes" (the failure modes are per-service so they can't be
# auto-generated).

resource "google_service_account" "scheduler" {
  account_id   = "${var.project_name}-scheduler"
  display_name = "Cloud Scheduler invoker for Python /ready probes"
  description  = "Used by hourly Cloud Scheduler jobs to call internal Python Cloud Run /ready endpoints with OIDC tokens."
}

locals {
  # Single source of truth for Python readiness targets — store the full
  # service objects so downstream resources can derive both `.name` (for IAM)
  # and `.uri` (for scheduler target + OIDC audience) from one entry. Adding
  # a fourth Python service really is one new line here, no other edits.
  #
  # Keys use dashes (matching the URL-safe Cloud Run service names that land
  # in scheduler `name` and the `service` metric label); the right-hand-side
  # TF resource references use underscores per Terraform identifier
  # conventions. Not a typo — the asymmetry is intentional.
  python_readiness_targets = {
    bq-inserter      = google_cloud_run_v2_service.bq_inserter
    postgres-writer  = google_cloud_run_v2_service.postgres_writer
    deletion-service = google_cloud_run_v2_service.deletion_service
  }
}

# Allow the scheduler SA to invoke each Python Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "scheduler_python_invoker" {
  for_each = local.python_readiness_targets

  project  = var.gcp_project_id
  location = var.gcp_region
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "python_readiness" {
  for_each = local.python_readiness_targets

  name        = "${var.project_name}-${var.environment}-${each.key}-readiness"
  description = "DB-touching readiness probe for ${each.key} (shares var.readiness_probe_schedule)"
  schedule    = var.readiness_probe_schedule
  time_zone   = "UTC"
  region      = var.gcp_region

  retry_config {
    retry_count = 0 # one shot; failure is the signal
  }

  http_target {
    http_method = "GET"
    uri         = "${each.value.uri}/ready"

    # Python services are private Cloud Run (INGRESS_TRAFFIC_INTERNAL_ONLY)
    # — caller needs roles/run.invoker via OIDC. The audience must equal the
    # service URI for Cloud Run to accept the token.
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = each.value.uri
    }
  }

  depends_on = [
    google_project_service.required_apis,
    google_cloud_run_v2_service_iam_member.scheduler_python_invoker,
  ]
}

# Single log-based metric covering all three Python readiness jobs. The
# `service` label is extracted from job_id so the alert can group per
# service without spawning one metric per job.
resource "google_logging_metric" "python_readiness_failures" {
  name        = "${var.project_name}_${var.environment}_python_readiness_failures"
  description = "Cloud Scheduler readiness probe responses that aren't 2xx (Python services)"
  # Filter is interpolated from local.python_readiness_targets so adding a
  # service auto-extends the metric. The regex is intentionally pinned to
  # the known service slugs (rather than a wildcard `.*-readiness`) so a
  # future unrelated job named `<project>-<env>-foo-readiness` doesn't
  # silently get bucketed in and fire false positives.
  filter = <<-EOT
    resource.type="cloud_scheduler_job"
    resource.labels.job_id=~"^${var.project_name}-${var.environment}-(${join("|", keys(local.python_readiness_targets))})-readiness$"
    httpRequest.status>=400
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "service"
      value_type  = "STRING"
      description = "Python service slug (${join(" | ", keys(local.python_readiness_targets))})"
    }
  }
  label_extractors = {
    "service" = "REGEXP_EXTRACT(resource.labels.job_id, \"(${join("|", keys(local.python_readiness_targets))})-readiness$\")"
  }
}

# Single alert with per-service grouping — three alert series, one policy.
resource "google_monitoring_alert_policy" "python_readiness_failing" {
  display_name = "🚨 Python service /ready failing"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH**: 3 consecutive hourly readiness probes against a Python
      service `/ready` have failed in the last 4 hours. The `service` label
      on the alert tells you which one (${join(" / ", keys(local.python_readiness_targets))}).

      Likely causes (add a bullet here when adding a new service to
      local.python_readiness_targets):
      - postgres-writer: Neon down, pool exhausted
      - bq-inserter: BigQuery permissions drift, dataset missing
      - deletion-service: BigQuery or Firestore credential expired

      **Action**:
      1. Check the failing service's logs for `Readiness probe '...' failed`.
         Lines ending in `; retrying after ...s` are transient cold-start
         spikes that recovered on the second attempt — only `failed after
         retry` lines indicate the probe ultimately failed.
      2. Test the endpoint directly via the scheduler's "Run now" button.
      3. Cross-check with apigateway readiness alert — concurrent failures
         on apigateway + postgres-writer indicate a shared (Neon) outage.
    EOT
  }

  conditions {
    display_name = "Readiness probe failures ≥ 3 in 4h (per service)"
    condition_threshold {
      filter          = "resource.type=\"cloud_scheduler_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.python_readiness_failures.name}\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 2 # > 2 means ≥3 failures
      aggregations {
        alignment_period     = "14400s" # 4 hours, mirrors apigateway_readiness_failing
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.service"]
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

# ============================================================================
# Application-metric Alerts (OTel histograms + gauges)
# ============================================================================
# Thresholds below are intentionally conservative placeholders — the plan is
# to observe a week of P99 data in Cloud Monitoring, then tune. If an alert
# fires repeatedly on normal traffic, loosen the threshold; if it never fires
# when something clearly went wrong, tighten it. All histograms are emitted
# with WithUnit("ms"), so threshold_value is in milliseconds.
#
# All alerts in this block are gated on var.enable_application_metric_alerts.
# Cloud Monitoring rejects an alert that references a metric descriptor which
# doesn't exist yet, and these descriptors are auto-created by the OTel GCP
# exporter only after the app emits each metric at least once. So: leave the
# flag false for a first-ever deploy; flip true on a follow-up apply after
# the services have run long enough for one metrics flush (~60s default).

resource "google_monitoring_alert_policy" "postgres_pool_exhaustion" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ Postgres: Connection pool near exhaustion"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH**: apigateway's Postgres connection pool has ≥4 connections in use
      (default max is 5 via `DB_POOL_MAX_CONNS`). Sustained exhaustion causes
      request queueing and rising `postgres/query.duration` tails.

      **Action**:
      1. Check `postgres/query.duration` P99 — slow queries hold connections.
      2. If traffic grew, consider raising `DB_POOL_MAX_CONNS` (Neon pooled endpoint can handle more).
      3. If no query is slow, look for connection leaks in recent code changes.
    EOT
  }

  conditions {
    display_name = "in_use connections > 3 for 5m"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/postgres/pool.connections\" AND resource.type=\"generic_task\" AND metric.labels.state=\"in_use\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 3

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "strava_api_latency" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ Strava API P99 latency high"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: P99 Strava API call duration exceeded 5s placeholder for ≥5 minutes.
      Strava's own latency dominates here; if this fires often, check Strava's status
      page before assuming it's us. Tune threshold after observing a week of data.
    EOT
  }

  conditions {
    display_name = "strava/api.duration P99 > 5000ms"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/strava/api.duration\" AND resource.type=\"generic_task\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5000

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["metric.labels.operation"]
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

resource "google_monitoring_alert_policy" "http_request_latency" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ HTTP request P99 latency high"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: P99 HTTP request duration (across dispatcher + apigateway)
      exceeded 2s placeholder for ≥5 minutes. Placeholder threshold — tune after
      a week of observed data.
    EOT
  }

  conditions {
    display_name = "http/request.duration P99 > 2000ms"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/http/request.duration\" AND resource.type=\"generic_task\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 2000

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

resource "google_monitoring_alert_policy" "postgres_query_latency" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ Postgres query P99 latency high"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: P99 Postgres query duration exceeded 500ms placeholder for ≥5 minutes.
      Expected queries should be fast (indexed lookups, < 50ms typical). A sustained
      P99 at 500ms suggests missing index, table bloat, or connection contention.
      Placeholder threshold — tune after a week of observed data.
    EOT
  }

  conditions {
    display_name = "postgres/query.duration P99 > 500ms"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/postgres/query.duration\" AND resource.type=\"generic_task\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 500

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["metric.labels.operation"]
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

resource "google_monitoring_alert_policy" "firestore_operation_latency" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ Firestore operation P99 latency high"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: P99 Firestore operation duration exceeded 1s placeholder for ≥5 minutes.
      Placeholder threshold — tune after a week of observed data.
    EOT
  }

  conditions {
    display_name = "firestore/operation.duration P99 > 1000ms"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/firestore/operation.duration\" AND resource.type=\"generic_task\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1000

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["metric.labels.operation"]
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

resource "google_monitoring_alert_policy" "pubsub_publish_latency" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ PubSub publish P99 latency high"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: P99 PubSub publish duration exceeded 1s placeholder for ≥5 minutes.
      Publish should be sub-100ms typically; sustained slowness here blocks the
      dispatcher's webhook response path. Placeholder threshold — tune after a
      week of observed data.
    EOT
  }

  conditions {
    display_name = "pubsub/publish.duration P99 > 1000ms"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/pubsub/publish.duration\" AND resource.type=\"generic_task\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1000

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# CRITICAL: No webhook events received for 24h. Catches the silent-
# failure case (Strava down, OAuth revoked, dispatcher crashed-but-
# healthy) that 5xx/DLQ/latency alerts can't see because they require
# traffic to fire. 24h window naturally tolerates rest days and short
# trips; sustained silence past that is the real signal.
#
# Gated on var.enable_application_metric_alerts (same pattern as the
# OTel histogram alerts below). The "metric must exist before alert
# can be created" trap caught us on the first tf-52 deploy: presence
# of the metric in a dashboard tile does NOT prove the descriptor
# exists — the descriptor is auto-created only when the dispatcher
# emits the counter for the first time. Keep this alert gated until a
# webhook has actually fired in the target environment, then flip
# enable_application_metric_alerts = true on a follow-up apply.
resource "google_monitoring_alert_policy" "webhook_events_absent" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "🚨 No Strava webhook events received in 24h"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **CRITICAL**: No `workload.googleapis.com/desirelines.io/webhook/events` increments observed in
      the last 24 hours. Real failure modes:

      1. **Strava OAuth revoked** — user revoked app access, or token
         expired and refresh failed silently.
      2. **Strava webhook subscription dropped** — the subscription
         registered with Strava no longer points at our dispatcher.
      3. **Dispatcher healthy but broken** — process running, uptime
         check passing, but webhook handler is throwing exceptions
         that don't bubble up as 5xx (e.g. proto deserialization
         silently no-ops).
      4. **Strava-side outage** — verify at https://status.strava.com.

      **Action**:
      1. Check Strava status page first.
      2. Try a manual activity upload to Strava — does the webhook
         arrive in dispatcher logs?
      3. If no webhook: check Strava API webhook subscription is
         still active (curl Strava's `/push_subscriptions` endpoint).
      4. If webhook arrives but counter doesn't increment: dispatcher
         logs will show the failure path.

      **Why this alert exists**: Other alerts fire on bad behavior;
      this one fires on absence of behavior. See epic 14-observability
      Q5.
    EOT
  }

  conditions {
    display_name = "webhook_events rate = 0 over 24h"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/events\" AND resource.type=\"generic_task\""
      duration        = "0s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1 # any non-zero count over the window passes

      aggregations {
        alignment_period     = "86400s" # 24 hours
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    # Must exceed the 24h evaluation window. With duration=0s over a 24h
    # alignment, sustained silence keeps the condition met; a short auto_close
    # would close the incident mid-outage and let it re-fire as soon as the
    # policy re-evaluates, creating notification churn. 7 days gives ample
    # investigation time without manufacturing a fake "resolved" state.
    auto_close = "604800s"
  }
}

# HIGH: Orphan tokens — an allowlisted athlete's webhook arrived but the
# dispatcher had no Firestore tokens for them. This indicates real data loss
# (Firestore wipe, deauth/re-auth race, partial migration) rather than the
# expected stray-webhook case. Distinct from STRAVA_FETCH_FAILED 5xx alerts
# because the dispatcher acks orphans with 200 to stop Strava retries — the
# orphan condition is ONLY visible via this counter label.
#
# Stray (`result=stray`) is intentionally NOT alerted — those are routine
# byproducts of cross-env or post-deauth Strava grants, ack'd silently.
#
# Gated on enable_application_metric_alerts for the same reason as the other
# OTel-derived alerts: the metric descriptor must exist before the alert can
# be created.
resource "google_monitoring_alert_policy" "webhook_owner_check_orphan" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "🚨 Webhook for allowlisted athlete with no tokens (orphan)"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **HIGH**: Dispatcher received a webhook for an athlete who IS on the
      allowlist but has no Firestore tokens. The event was acked (Strava will
      not retry) but nothing else happened. Possible causes:

      1. **Firestore tokens were deleted** — accidental delete, partial
         migration, or a deauth event that wasn't followed by re-auth.
      2. **Deauth/re-auth race** — narrow window between
         `tokenStore.DeleteTokens` and the user's re-auth callback writing
         new tokens. Self-resolves on the next event after re-auth.
      3. **Token write race** — concurrent token refreshes lost a write.
         Should not happen given the optimistic-concurrency guard, but
         worth investigating if it recurs.

      **Action**:
      1. Identify the affected athlete from the dispatcher log line:
         `Orphan tokens — allowlisted athlete has no tokens`.
      2. Check Firestore at `users/{athleteID}/private/strava_tokens` —
         is the document missing or stale?
      3. If genuinely missing, ask the user to re-authorize via the app's
         OAuth flow. Webhooks resume on the next event.
      4. If it recurs without an obvious cause, suspect a deletion bug
         (search recent commits to `dispatcher/adapters/firestore/`).
    EOT
  }

  conditions {
    display_name = "owner_check{result=orphan} rate > 0 for 5m"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/owner_check\" AND resource.type=\"generic_task\" AND metric.labels.result=\"orphan\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# MEDIUM: The allowlist read itself is failing. Dispatcher fail-closes with
# 500 in this case so Strava retries up to 3× — bounded blast radius — but a
# sustained allowlist outage means legitimate webhooks are getting dropped
# after Strava gives up. This catches Firestore-side trouble that's specific
# to the allowlist read path (the broader firestore/operation.duration alert
# would also fire, but only on latency, not hard errors).
resource "google_monitoring_alert_policy" "webhook_owner_check_error" {
  count = var.enable_application_metric_alerts ? 1 : 0

  display_name = "⚠️ Allowlist read errors elevated"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **MEDIUM**: Dispatcher's allowlist check is returning errors at >1/min
      sustained. The handler fail-closes with 500 (Strava retries up to 3×),
      but past the retry cap legitimate events are dropped.

      **Action**:
      1. Check Firestore status (https://status.cloud.google.com).
      2. Verify the dispatcher's service account still has
         `roles/datastore.user` on the user-configs database.
      3. Inspect dispatcher logs for the `ALLOWLIST_CHECK_FAILED` error code —
         the wrapped error names the specific Firestore failure.
    EOT
  }

  conditions {
    display_name = "owner_check{result=error} rate > 1/min for 10m"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/owner_check\" AND resource.type=\"generic_task\" AND metric.labels.result=\"error\""
      duration        = "600s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
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
    dlq_bq_inserter              = google_monitoring_alert_policy.dlq_bq_inserter.id
    dlq_postgres_writer          = google_monitoring_alert_policy.dlq_postgres_writer.id
    service_4xx                  = google_monitoring_alert_policy.service_4xx_errors.id
    service_5xx                  = google_monitoring_alert_policy.service_5xx_errors.id
    old_messages                 = google_monitoring_alert_policy.old_messages.id
    apigateway_uptime            = google_monitoring_alert_policy.apigateway_uptime.id
    apigateway_readiness_failing = google_monitoring_alert_policy.apigateway_readiness_failing.id
    python_readiness_failing     = google_monitoring_alert_policy.python_readiness_failing.id
    frontend_uptime              = google_monitoring_alert_policy.frontend_uptime.id
    postgres_pool_exhaustion     = one(google_monitoring_alert_policy.postgres_pool_exhaustion[*].id)
    strava_api_latency           = one(google_monitoring_alert_policy.strava_api_latency[*].id)
    http_request_latency         = one(google_monitoring_alert_policy.http_request_latency[*].id)
    postgres_query_latency       = one(google_monitoring_alert_policy.postgres_query_latency[*].id)
    firestore_operation_latency  = one(google_monitoring_alert_policy.firestore_operation_latency[*].id)
    pubsub_publish_latency       = one(google_monitoring_alert_policy.pubsub_publish_latency[*].id)
    webhook_events_absent        = one(google_monitoring_alert_policy.webhook_events_absent[*].id)
    webhook_owner_check_orphan   = one(google_monitoring_alert_policy.webhook_owner_check_orphan[*].id)
    webhook_owner_check_error    = one(google_monitoring_alert_policy.webhook_owner_check_error[*].id)
  }
}
