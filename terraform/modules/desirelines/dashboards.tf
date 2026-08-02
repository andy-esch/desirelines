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
#
# Threshold-line convention (a tile's `thresholds = [{ value = ... }]`):
#   - Match an SLO target exactly when one exists (visual cue for budget burn).
#   - Match an alert threshold exactly when one exists (visual cue for paging risk).
#   - Otherwise omit, OR keep only with an explicit `label` saying what it is
#     (e.g. "informational" / "planned, not yet deployed"). A bare threshold
#     with no paired SLO/alert misleads more than it informs.
# See audit 2026-05-29-terraform-ci (M3) for the prior drift incident.
# ============================================================================

resource "google_monitoring_dashboard" "desirelines_observability" {
  dashboard_json = jsonencode({
    displayName = "Desirelines ${title(var.environment)} - Production Observability"

    # Mosaic layout with 12-column grid
    mosaicLayout = {
      columns = 12

      tiles = [
        # ====================================================================
        # Section Header: SLO Compliance - Row 0
        # ====================================================================
        # Four scorecards (one per active SLO) showing the fraction of the
        # 30-day error budget remaining. 1.0 = full budget, 0 = exhausted.
        # Thresholds: < 0.25 → red (≤7 days of budget left at current burn);
        # < 0.50 → yellow; otherwise green. Detailed compliance + burn-rate
        # drill-down lives in Monitoring → Services (GCP-native UI for SLOs).
        {
          width  = 12
          height = 2
          widget = {
            title = "🎯 SLO Compliance"
            text = {
              content = "Fraction of each 30-day error budget remaining. Red below 25% — investigate before the budget burns out. See Monitoring → Services for full SLO drill-down."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # SLO 1 budget fraction - Row 2
        {
          yPos   = 2
          width  = 3
          height = 4
          widget = {
            title = "SLO 1 Dispatcher availability (99%)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "select_slo_budget_fraction(\"${google_monitoring_slo.dispatcher_availability.name}\")"
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
              gaugeView = {
                upperBound = 1
              }
              thresholds = [
                { value = 0.25, color = "RED", direction = "BELOW" },
                { value = 0.50, color = "YELLOW", direction = "BELOW" },
              ]
            }
          }
        },

        # SLO 2 budget fraction - Row 2
        {
          xPos   = 3
          yPos   = 2
          width  = 3
          height = 4
          widget = {
            title = "SLO 2 Webhook ingest success (99%)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "select_slo_budget_fraction(\"${google_monitoring_slo.webhook_ingest_success.name}\")"
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
              gaugeView = {
                upperBound = 1
              }
              thresholds = [
                { value = 0.25, color = "RED", direction = "BELOW" },
                { value = 0.50, color = "YELLOW", direction = "BELOW" },
              ]
            }
          }
        },

        # SLO 4 budget fraction - Row 2
        {
          xPos   = 6
          yPos   = 2
          width  = 3
          height = 4
          widget = {
            title = "SLO 4 Apigateway availability (99.5%)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "select_slo_budget_fraction(\"${google_monitoring_slo.apigateway_availability.name}\")"
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
              gaugeView = {
                upperBound = 1
              }
              thresholds = [
                { value = 0.25, color = "RED", direction = "BELOW" },
                { value = 0.50, color = "YELLOW", direction = "BELOW" },
              ]
            }
          }
        },

        # SLO 5 budget fraction - Row 2
        {
          xPos   = 9
          yPos   = 2
          width  = 3
          height = 4
          widget = {
            title = "SLO 5 Apigateway latency (95% < 1s)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "select_slo_budget_fraction(\"${google_monitoring_slo.apigateway_latency.name}\")"
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
              gaugeView = {
                upperBound = 1
              }
              thresholds = [
                { value = 0.25, color = "RED", direction = "BELOW" },
                { value = 0.50, color = "YELLOW", direction = "BELOW" },
              ]
            }
          }
        },

        # ====================================================================
        # Section Header: Dead Letter Queues (CRITICAL) - Row 6
        # ====================================================================
        {
          yPos   = 6
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

        # BQ Inserter DLQ - Row 8, Left
        {
          yPos   = 8
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

        # Postgres Writer DLQ - Row 8, Right
        {
          xPos   = 6
          yPos   = 8
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
        # Section Header: Cloud Run Performance - Row 12
        # ====================================================================
        {
          yPos   = 12
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

        # Service Request Counts - Row 14
        {
          yPos   = 14
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
                        perSeriesAligner   = "ALIGN_SUM"
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

        # Service 4xx Errors - Row 18, Left
        {
          yPos   = 18
          width  = 6
          height = 4
          widget = {
            title = "Service 4xx Errors (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"4xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
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

        # Service 5xx Errors - Row 18, Right
        # The decorative threshold line at 0.05/sec was removed in
        # 2026-05-12 — it didn't correspond to any live alert after the
        # 5xx alert was reconciled into a ratio condition (alerts.tf) and
        # SLO 4/1 burn-rate alerts (slos.tf). SLO compliance scorecards
        # at the top of the dashboard cover the apigateway/dispatcher
        # 5xx burn signal; this tile is now pure visual reference for the
        # other Cloud Run services.
        {
          xPos   = 6
          yPos   = 18
          width  = 6
          height = 4
          widget = {
            title = "Service 5xx Errors (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-.*\") AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
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

        # Service Request Latency (P95) - Row 22, Full Width
        {
          yPos   = 22
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
              # Aligned to SLO 5 (apigateway latency: 95% < 1s). The prior
              # 5000ms line predated SLOs and read 5× looser than the actual
              # target, so the tile looked healthy while the SLO budget burned.
              thresholds = [{
                value = 1000
                label = "SLO 5 target (1s)"
              }]
            }
          }
        },

        # Service Instance Count - Row 26
        {
          yPos   = 26
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
        # Section Header: PubSub Message Flow - Row 30
        # ====================================================================
        {
          yPos   = 30
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

        # Messages Published - Row 32, Left
        {
          yPos   = 32
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
                      perSeriesAligner   = "ALIGN_SUM"
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

        # Unacked Messages - Row 32, Right
        {
          xPos   = 6
          yPos   = 32
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
                label = "Messages"
                scale = "LINEAR"
              }
              # Soft eyeball reference only — there is no backlog-count alert
              # (the `old_messages` alert fires on oldest-unacked *age*, mirrored
              # by the tile below). Kept as a visual "this is a lot of backlog"
              # cue; not an SLO/alert boundary.
              thresholds = [{
                value = 100
              }]
            }
          }
        },

        # Oldest Unacked Message Age - Row 36
        {
          yPos   = 36
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
        # Section Header: Cloud Run Resource Utilization - Row 40
        # ====================================================================
        {
          yPos   = 40
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

        # CPU Utilization - Row 42, Left
        {
          yPos   = 42
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

        # Memory Utilization - Row 42, Right
        {
          xPos   = 6
          yPos   = 42
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

        # Startup Latency - Row 46
        {
          yPos   = 46
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
        # Section Header: PubSub Delivery Performance - Row 50
        # ====================================================================
        {
          yPos   = 50
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

        # Push Delivery Latency - Row 52, Left
        {
          yPos   = 52
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

        # Push Delivery Results - Row 52, Right
        {
          xPos   = 6
          yPos   = 52
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
                      perSeriesAligner   = "ALIGN_SUM"
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
        # Section Header: Application Metrics (OTel) - Row 56
        # ====================================================================
        {
          yPos   = 56
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

        # Strava API Latency - Row 58, Left
        {
          yPos   = 58
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

        # PostgreSQL Query Latency - Row 58, Right
        {
          xPos   = 6
          yPos   = 58
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

        # BigQuery Operation Latency - Row 62, Left
        {
          yPos   = 62
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

        # Webhook Events Counter - Row 62, Right
        {
          xPos   = 6
          yPos   = 62
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
                      perSeriesAligner   = "ALIGN_SUM"
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

        # Connection Pool Gauge - Row 66
        {
          yPos   = 66
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

        # Webhook Owner Allowlist Check - Row 70
        # Plots the four owner-check outcomes:
        #   allowed  — happy path; matches the webhook/events rate
        #   stray    — not allowlisted; expected, ack'd silently
        #   orphan   — allowlisted but no Firestore tokens; alerts
        #   error    — allowlist read failed; alerts at >1/min
        {
          yPos   = 70
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
                      perSeriesAligner   = "ALIGN_SUM"
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

        # Postgres Writer Operation Latency (P95) - Row 74, Full Width
        # Sister metric to postgres/query.duration (apigateway side); this
        # one comes from the postgres-writer service. Operation labels:
        # insert, activities_insert, update_metadata, delete.
        # `activities_insert` surfaces the Neon cold-compute signal:
        # warm-path ~180ms, cold ~1s+.
        {
          yPos   = 74
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
        },

        # Webhook freshness P95 by aspect_type - Row 78, Full Width
        # Source for SLO 3 (data freshness). Three series after the
        # `feat/extend-webhook-freshness-metric-to-update-and-delete` PR
        # lands — CREATE has been emitting since 2026-05-09; UPDATE and
        # DELETE start emitting once that PR deploys. Threshold reference
        # line at 3000ms matches SLO 3's planned target; update the value
        # if SLO 3 wires with a different calibrated threshold after the
        # data window matures.
        {
          yPos   = 78
          width  = 12
          height = 4
          widget = {
            title = "Webhook freshness P95 by aspect_type (anchors SLO 3)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/end_to_end.duration\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
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
                label = "Milliseconds"
                scale = "LINEAR"
              }
              # Planned SLO 3 (data freshness) target — SLO 3 is NOT yet
              # deployed (slos.tf:17-20 tracks it as MQL-based, separate). Kept
              # as the aspirational anchor the `wire-slo-3-freshness` task will
              # calibrate against once ≥7-30d of data lands; labeled so an
              # operator doesn't read it as an active SLO line.
              thresholds = [{
                value = 3000
                label = "Planned SLO 3 target (not yet deployed)"
              }]
            }
          }
        },

        # ====================================================================
        # Section Header: Security signals - Row 82
        # ====================================================================
        # Per-response-code rate tiles paired 1:1 with the security alerts
        # in `alerts.tf` (`apigateway_auth_failure_surge`,
        # `apigateway_not_found_surge`, `apigateway_rate_limited_surge`,
        # `dispatcher_bad_request_surge`). Each tile carries a threshold
        # line at the alert's firing value so "how close are we to firing?"
        # is one-glance.
        #
        # Chart values are events/min (ALIGN_SUM over a 60s window).
        # Thresholds (10, 5, 5, 5 per min) match the alert firing points.
        # Note: alerts in `alerts.tf` use ALIGN_RATE with thresholds
        # 0.167 and 0.0833 (events/sec) — mathematically equivalent at
        # 60s alignment (10/60 = 0.167, 5/60 = 0.0833).
        {
          yPos   = 82
          width  = 12
          height = 2
          widget = {
            title = "🔒 Security signals"
            text = {
              content = "Per-response-code anomaly rates. Threshold line on each tile shows where the matching alert in `alerts.tf` fires. Sustained values near or above the line mean adversarial activity is likely; investigate in logs and consider blocking the source IP."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # 401/403 rate (apigateway) - Row 84
        {
          yPos   = 84
          width  = 3
          height = 4
          widget = {
            title = "401/403 apigateway (alert at 10/min)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.api_gateway.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code=monitoring.regex.full_match(\"401|403\")"
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 10 # = 10/min, matches apigateway_auth_failure_surge
              }]
            }
          }
        },

        # 404 rate (apigateway) - Row 84
        {
          xPos   = 3
          yPos   = 84
          width  = 3
          height = 4
          widget = {
            title = "404 apigateway (alert at 5/min)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.api_gateway.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code=\"404\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 5 # = 5/min, matches apigateway_not_found_surge
              }]
            }
          }
        },

        # 429 rate (apigateway) - Row 84
        {
          xPos   = 6
          yPos   = 84
          width  = 3
          height = 4
          widget = {
            title = "429 apigateway (alert at 5/min)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.api_gateway.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code=\"429\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 5 # = 5/min, matches apigateway_rate_limited_surge
              }]
            }
          }
        },

        # 400 rate (dispatcher) - Row 84
        {
          xPos   = 9
          yPos   = 84
          width  = 3
          height = 4
          widget = {
            title = "400 dispatcher (alert at 5/min)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.dispatcher.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code=\"400\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/min"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 5 # = 5/min, matches dispatcher_bad_request_surge
              }]
            }
          }
        },

        # SLO burn rate (1h window) - Row 88, Full Width
        # Visualizes the same `select_slo_burn_rate(..., "3600s")` signal
        # the fast-burn alerts fire on. Threshold line at 14.4× marks the
        # alert sensitivity — sustained values above the line for ~14 min
        # of the 1h window would burn 2% of the 30-day budget and trigger
        # the fast-burn alert. Slow-burn (6× over 6h) isn't shown here;
        # it's a separate, less time-sensitive signal best inspected via
        # GCP Monitoring → Services.
        {
          yPos   = 88
          width  = 12
          height = 4
          widget = {
            title = "SLO burn rate (1h window) — fast-burn alerts fire above 14.4×"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "select_slo_burn_rate(\"${google_monitoring_slo.dispatcher_availability.name}\", \"3600s\")"
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "SLO 1 dispatcher availability"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "select_slo_burn_rate(\"${google_monitoring_slo.webhook_ingest_success.name}\", \"3600s\")"
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "SLO 2 webhook ingest success"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_availability.name}\", \"3600s\")"
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "SLO 4 apigateway availability"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "select_slo_burn_rate(\"${google_monitoring_slo.apigateway_latency.name}\", \"3600s\")"
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "SLO 5 apigateway latency"
                },
              ]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Burn rate (×)"
                scale = "LINEAR"
              }
              thresholds = [{
                value = 14.4 # fast-burn threshold (2% of 30d budget in 1h)
              }]
            }
          }
        },

        # ====================================================================
        # BIGQUERY CDC ACTIVITY-ROW PATH - Row 92
        # ====================================================================
        {
          yPos   = 92
          width  = 12
          height = 2
          widget = {
            title = "🧪 BigQuery CDC Activity Rows"
            text = {
              content = "Best-effort second publish to `activities_live`. Failures cannot affect webhooks or the primary pipeline, so these tiles are the only view of it."
              format  = "MARKDOWN"
              style   = {}
            }
          }
        },

        # Activity-row publish outcomes - Row 94, Left
        {
          yPos   = 94
          width  = 6
          height = 4
          widget = {
            title = "Activity Row Publish Outcomes (per minute)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"workload.googleapis.com/desirelines.io/bigquery/row_publish\" AND resource.type=\"generic_task\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      # `result` separates published/skipped/error; `detail`
                      # says which change type or which failure. Skipped is
                      # normal — do not read it as a problem.
                      groupByFields = ["metric.label.result", "metric.label.detail"]
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              timeshiftDuration = "0s"
              yAxis = {
                label = "Events/sec"
                scale = "LINEAR"
              }
            }
          }
        },

        # Activity-rows DLQ - Row 94, Right
        {
          xPos   = 6
          yPos   = 94
          width  = 6
          height = 4
          widget = {
            title = "Activity Rows DLQ Messages (BigQuery rejected)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.activity_rows_dlq_monitoring.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
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
        }
      ]
    }
  })
}
