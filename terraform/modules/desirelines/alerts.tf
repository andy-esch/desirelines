# ============================================================================
# Alert Policies (non-SLO, non-uptime, non-readiness)
# ============================================================================
# Static-threshold alert policies covering DLQs, Cloud Run 4xx/5xx error
# rates, PubSub backlog age, and OTel application metrics (postgres pool,
# strava/http/postgres/firestore/pubsub latency, webhook counters,
# owner-check outcomes).
#
# Notification channels come from `local.notification_channels` in
# `monitoring.tf`. SLO burn-rate alerts live in `slos.tf`. Uptime alerts
# stay co-located with their probes in `uptime_checks.tf`; readiness
# alerts likewise in `readiness_probes.tf`.
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
