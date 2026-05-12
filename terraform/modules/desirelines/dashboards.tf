# ============================================================================
# Monitoring Dashboard
# ============================================================================
# Single Cloud Monitoring dashboard for at-a-glance observability:
# - Dead Letter Queue health (critical early warning)
# - Cloud Run service performance and errors
# - PubSub message flow and backlogs
# - Cloud Run resource utilization
# - PubSub push-delivery performance
# - Application metrics (OTel) — Strava/Postgres/BigQuery latency, webhook
#   counters, owner-check outcomes, postgres-writer operation latency.
#
# Alert policies live in `alerts.tf` / `uptime_checks.tf` / `readiness_probes.tf`;
# SLO compliance + burn-rate alerts in `slos.tf`.
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
