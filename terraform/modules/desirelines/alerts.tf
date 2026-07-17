# ============================================================================
# Alert Policies (non-SLO, non-uptime, non-readiness)
# ============================================================================
# Static-threshold alert policies in three categories:
#   - Pipeline health: DLQ messages (BQ inserter, Postgres writer),
#     PubSub backlog age, non-SLO Cloud Run 5xx ratio.
#   - Security: per-response-code anomaly signals (401/403, 404, 429
#     on apigateway; 400 on dispatcher). Each maps a single response_code
#     to a specific attack pattern (credential stuffing, scanner activity,
#     rate-limiter engagement, webhook tampering).
#   - OTel application metrics: postgres pool, strava/http/postgres/firestore/
#     pubsub latency, webhook event counters, owner-check outcomes.
#
# Notification channels come from `local.notification_channels` in
# `monitoring.tf`. SLO burn-rate alerts live in `slos.tf`. Uptime alerts
# stay co-located with their probes in `uptime_checks.tf`; readiness
# alerts likewise in `readiness_probes.tf`.
# ============================================================================

# Shared Cloud Run `request_count` filter prefixes, scoped per service. The
# `resource.type + service_name + metric.type` head was hand-duplicated across
# every per-response-code alert below (and the same fragment recurs in
# dashboards.tf), so a service rename or metric-type change meant editing many
# strings in lockstep. Centralizing the head here makes each alert's `filter`
# just the prefix + its response-code suffix. (SLO SLIs in slos.tf use a
# different filter syntax — `resource.label."service_name"`, space-joined — so
# they intentionally don't share these.)
locals {
  apigateway_request_count      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.api_gateway.name}\" AND metric.type=\"run.googleapis.com/request_count\""
  dispatcher_request_count      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.dispatcher.name}\" AND metric.type=\"run.googleapis.com/request_count\""
  python_services_request_count = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=monitoring.regex.full_match(\"desirelines-(bq-inserter|postgres-writer|deletion-service)\") AND metric.type=\"run.googleapis.com/request_count\""
}

# CRITICAL: DLQ Messages Detected (BQ Inserter)
resource "google_monitoring_alert_policy" "dlq_bq_inserter" {
  display_name = "🚨 DLQ: BQ Inserter Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/dlq-bq-inserter.md

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

# CRITICAL: DLQ Messages Detected (Deletion Service)
# The GDPR / Strava API Agreement §5.4 deauth path: a terminally-failed user-data
# deletion (5 delivery attempts exhausted) lands here. This is the most
# compliance-sensitive DLQ in the system, yet it was the only one without a
# depth alert — the `old_messages` alert covers the delivery sub during retries
# but auto-closes once the message moves to the DLQ, leaving no active page.
# NOTE: dlq_bq_inserter / dlq_postgres_writer / dlq_deletion_service are now
# identical but for the subscription + prose; a for_each over the three services
# is the natural next refactor (see 2026-07-17-terraform-ci M1 tightening), left
# out here to keep the change purely additive (no state migration of the two
# existing production alerts).
resource "google_monitoring_alert_policy" "dlq_deletion_service" {
  display_name = "🚨 DLQ: Deletion Service Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/dlq-deletion-service.md

      **CRITICAL**: The Deletion Service Dead Letter Queue has messages.

      A user-data deletion (Strava deauthorization) has failed all delivery
      attempts. This is a compliance-sensitive failure — user data may not have
      been deleted within the required window.

      **Action Required**:
      1. Check DLQ messages in PubSub console
      2. Review Deletion Service logs for errors
      3. Verify PostgreSQL / BigQuery / Firestore connectivity for the failed delete

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Deletion Service DLQ has messages"

    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.deletion_service_dlq.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
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
  display_name = "🚨 DLQ: PostgreSQL Writer Has Messages"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/dlq-postgres-writer.md

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

# ============================================================================
# SECURITY: Anomalous 4xx signals
# ============================================================================
# Four narrow alerts, one per attack pattern. At single-user volume
# (~0.04 req/min baseline) any sustained 4xx is anomalous; thresholds
# below are calibrated to fire on adversarial activity without tripping
# on the occasional legitimate edge case (e.g. token expiry).
#
# Why per-code instead of one unified "4xx > X" alert: each response_code
# maps to a distinct attack pattern with a distinct runbook. Splitting
# means the alert payload itself tells the on-caller what kind of incident
# they're looking at.
#
# Thresholds are placeholders — re-tune after observing a week of real
# baseline data. Bias is toward sensitivity rather than precision; a few
# false positives on the user's own browser are cheaper than missing a
# real probe.

# SECURITY (HIGH): Sustained 401/403 on apigateway — credential stuffing
# or OAuth code injection. Legit traffic occasionally hits 401 during
# Firebase token expiry/refresh; sustained 10/min is well above that.
resource "google_monitoring_alert_policy" "apigateway_auth_failure_surge" {
  display_name = "🔒 apigateway: 401/403 surge (credential attack)"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/apigateway-auth-failure-surge.md

      **HIGH**: apigateway is returning 401 or 403 at >10/min sustained for
      5 minutes. Most likely an external actor probing authenticated
      endpoints — credential stuffing, OAuth code injection on the
      `/auth/callback` path, or stale-token replay.

      **Action**:
      1. Check apigateway logs for the request paths — `/auth/*` vs `/v1/*`
         distinguishes OAuth attack from authenticated-endpoint probe.
      2. Inspect source IPs / user agents in the logs. A single IP
         hammering ⇒ block at Firebase Hosting or Cloud Armor. Many IPs
         ⇒ distributed scanner.
      3. If concentrated on `/auth/callback`: review the recent OAuth
         flow — was a Strava code leaked, did a redirect URI change?
      4. Don't react to a single brief spike around token-expiry events;
         the 5-min duration filter should already absorb those.
    EOT
  }

  conditions {
    display_name = "401/403 rate > 10/min sustained"

    condition_threshold {
      filter          = "${local.apigateway_request_count} AND metric.labels.response_code=monitoring.regex.full_match(\"401|403\")"
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.167 # ≈ 10/min under ALIGN_RATE per-second

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# SECURITY (MEDIUM): Sustained 404 on apigateway — directory enumeration
# or vulnerability scanning. Legit users essentially never generate 404
# (no navigation reaches nonexistent routes); any sustained volume is a bot.
resource "google_monitoring_alert_policy" "apigateway_not_found_surge" {
  display_name = "🔒 apigateway: 404 surge (scanner activity)"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/apigateway-not-found-surge.md

      **MEDIUM**: apigateway is returning 404 at >5/min sustained for
      5 minutes. Almost always a bot probing for common attack paths
      (`/wp-admin`, `/.git/config`, `/.env`, etc.) since legitimate
      navigation doesn't produce 404s.

      **Action**:
      1. Check apigateway logs for the 404 paths — confirms it's a
         scanner and reveals what's being probed.
      2. If concentrated from a single IP / ASN: block at Firebase
         Hosting or Cloud Armor.
      3. If distributed and noisy: usually safe to ignore; public Cloud
         Run URLs get this constantly. Document the IP range to avoid
         re-triaging next time.
    EOT
  }

  conditions {
    display_name = "404 rate > 5/min sustained"

    condition_threshold {
      filter          = "${local.apigateway_request_count} AND metric.labels.response_code=\"404\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.0833 # ≈ 5/min under ALIGN_RATE per-second

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# SECURITY (HIGH): Sustained 429 on apigateway — rate-limiter middleware
# is engaging, which itself is the signal. Either an external flood or a
# misbehaving legitimate client. Threshold is intentionally low because
# even a few 429s in a window means real-volume traffic is being denied.
resource "google_monitoring_alert_policy" "apigateway_rate_limited_surge" {
  display_name = "🔒 apigateway: 429 surge (rate-limit engagement)"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/apigateway-rate-limited-surge.md

      **HIGH**: apigateway's rate-limiter middleware is returning 429 at
      >5/min sustained for 5 minutes. Either an external flood/DOS
      attempt or a misbehaving legitimate client looping a request.

      **Action**:
      1. Check apigateway logs for the source IP(s). Single source =
         likely deliberate; distributed = distributed flood.
      2. Cross-check with `apigateway_uptime` — if uptime is still
         passing, the limiter is doing its job.
      3. If a legit client (e.g. the web app in a polling-loop bug):
         find and fix the client. The web app has TanStack Query with
         AbortSignal — runaway requests usually mean a missing abort.
      4. If adversarial: consider tightening `var.api_rate_limit_*` or
         adding Cloud Armor in front.
    EOT
  }

  conditions {
    display_name = "429 rate > 5/min sustained"

    condition_threshold {
      filter          = "${local.apigateway_request_count} AND metric.labels.response_code=\"429\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.0833 # ≈ 5/min under ALIGN_RATE per-second

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# SECURITY (HIGH): Sustained 400 on dispatcher — webhook payload tampering
# or replay attempts. Strava sends well-formed payloads; bursts of 400 on
# the webhook endpoint mean someone is trying to manipulate or fuzz it.
resource "google_monitoring_alert_policy" "dispatcher_bad_request_surge" {
  display_name = "🔒 dispatcher: 400 surge (webhook tampering)"
  combiner     = "OR"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/dispatcher-bad-request-surge.md

      **HIGH**: dispatcher is returning 400 (Bad Request) at >5/min
      sustained for 5 minutes. Legitimate Strava webhook payloads are
      well-formed; bursts of 400 indicate someone is hitting the
      `/webhook` endpoint with crafted/replayed payloads.

      **Action**:
      1. Check dispatcher logs for the rejection reason — proto
         deserialization vs signature mismatch vs missing required field.
      2. Inspect source IPs. Strava webhook traffic comes from
         documented Strava IP ranges; any other origin is the actor.
      3. If volume is high enough to threaten capacity, block at
         Cloud Run ingress or via Cloud Armor.
      4. If a real Strava-side schema change is the cause (Strava added
         a required field): update proto + redeploy. Crosscheck the
         dispatcher's allowlist behavior — orphan tokens should still
         be handled gracefully.
    EOT
  }

  conditions {
    display_name = "400 rate > 5/min sustained"

    condition_threshold {
      filter          = "${local.dispatcher_request_count} AND metric.labels.response_code=\"400\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.0833 # ≈ 5/min under ALIGN_RATE per-second

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = local.notification_channels

  alert_strategy {
    auto_close = "3600s"
  }
}

# CRITICAL: 5xx Server Errors on non-SLO Cloud Run services
#
# Scope: bq-inserter, postgres-writer, deletion-service. The apigateway
# and dispatcher 5xx cases are covered by SLO 4 (apigateway availability)
# and SLO 1 (dispatcher availability) burn-rate alert pairs in slos.tf,
# so they're excluded here to avoid double-paging.
#
# Shape: ratio condition (5xx count / total count), not a raw rate. The
# pre-2026-05-12 version used ALIGN_RATE without a denominator, which
# meant threshold_value=0.02 was actually triggering at 0.02 events/sec
# (1.2/min), not "2% of requests" — a silent false-negative bug since
# the alert was authored.
#
# The matching 4xx alert was removed in the same change; 4xx is a client
# signal rather than a service-health signal, and at single-user volume
# it doesn't carry actionable information that the dashboard tile and
# log search don't already cover.
resource "google_monitoring_alert_policy" "service_5xx_errors" {
  display_name = "🚨 Cloud Run: 5xx errors on non-SLO services"
  # AND_WITH_MATCHING_RESOURCE: both the ratio AND the absolute-count floor
  # must trip for the SAME service before paging. These services scale to
  # zero and see near-zero traffic, so a single benign cold-start 503 (the
  # hourly readiness probe waking an idle instance) is ~100% of volume and
  # alone trips a bare 2% ratio. The count floor below gates that out: a real
  # outage produces a sustained burst of 5xx, a cold-start race produces one
  # or two. Matching-resource keeps the two conditions tied per service so a
  # ratio spike on one and a count burst on another can't combine into a
  # false page.
  combiner = "AND_WITH_MATCHING_RESOURCE"

  documentation {
    content = <<-EOT
      **Runbook**: docs/runbooks/service-5xx-server-errors.md

      **CRITICAL**: One of the non-SLO Cloud Run services is returning
      5xx at >2% of its request volume.

      **Monitored Services**:
      - desirelines-bq-inserter (BigQuery writer)
      - desirelines-postgres-writer (PostgreSQL writer)
      - desirelines-deletion-service (deletion handler)

      apigateway + dispatcher 5xx is covered by SLO 1 + SLO 4 burn-rate
      alerts (slos.tf) and is intentionally excluded from this policy.

      **Action Required**:
      1. Identify the failing service from the alert's `service_name` label
      2. Review service logs for stack traces and error details
      3. Check for recent deployments or configuration changes
      4. For bq_inserter / postgres_writer: cross-reference with the
         corresponding DLQ alert (failures here typically end up in DLQ)
      5. Verify dependencies (BigQuery, PostgreSQL, Firestore) are healthy

      Dashboard: ${google_monitoring_dashboard.desirelines_observability.id}
    EOT
  }

  conditions {
    display_name = "Non-SLO service 5xx ratio > 2%"

    condition_threshold {
      # 5xx count on the three non-SLO services
      filter             = "${local.python_services_request_count} AND metric.labels.response_code_class=\"5xx\""
      duration           = "300s" # 5 minutes
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.02 # 2% of requests on the rolling window
      denominator_filter = local.python_services_request_count

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
      denominator_aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  # Minimum-volume floor — ANDed with the ratio above so a single isolated
  # cold-start 503 can't page on its own. request_count is a DELTA counter;
  # ALIGN_SUM over a 10-minute window with REDUCE_SUM gives the absolute 5xx
  # count per service. threshold > 4 (≥5 in 10m) clears a transient cold-start
  # event — even the worst case (probe + its one retry + a Pub/Sub redelivery
  # all hitting the same cold instance) tops out at ~3-4 — while a sustained
  # real outage easily exceeds it. The exact floor is a first cut; calibrate
  # against real prod data (see the planning-repo SLO re-audit task).
  conditions {
    display_name = "Non-SLO service 5xx count ≥ 5 in 10m"

    condition_threshold {
      filter          = "${local.python_services_request_count} AND metric.labels.response_code_class=\"5xx\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 4 # > 4 means ≥5 5xx in the 10m window

      aggregations {
        alignment_period     = "600s" # 10 minutes
        per_series_aligner   = "ALIGN_SUM"
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
      **Runbook**: docs/runbooks/pubsub-old-unacked-messages.md

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
      # Scope to the three live push subscriptions (…-{service}-{env}) only.
      # The DLQ inspection subscriptions (…-{service}-dlq-{env}) retain unacked
      # messages by design, so they must be excluded. GCP Monitoring filters
      # have no NOT operator and RE2 has no negative lookahead, so this is an
      # explicit allowlist alternation: the trailing `-[a-z]+` matches the env
      # token (dev/prod) but not the `-dlq-{env}` suffix, which fails full_match.
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"desirelines-(bq-inserter|postgres-writer|deletion-service)-[a-z]+\") AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
      duration        = "300s" # 5 minutes
      comparison      = "COMPARISON_GT"
      threshold_value = 300 # 5 minutes in seconds

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.subscription_id"]
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
# Thresholds were initially shipped as placeholders. As of 2026-05-31 all six
# are tuned: four (strava_api, firestore_operation, pubsub_publish,
# postgres_pool) to ~2× observed 7-day P99. All five PromQL latency alerts use a
# 600s alert duration — strictly greater than their 5m rate window — so a single
# slow op clears the window before the duration elapses and can't page; only
# sustained degradation fires. Thresholds are bucket-boundary-aligned where the
# tuned value permits: http/postgres at 15s (first boundary above the ~10s
# scale-to-zero cold-start ceiling); firestore (1000) and pubsub (500) already
# land on boundaries; strava_api stays mid-bucket by design (2× its worst-op
# P99). See each policy's documentation for details.
#
# Format: histogram-based latency alerts and the webhook-absence alert use
# `condition_prometheus_query_language` (not `condition_threshold`) because
# the GCP OTel exporter emits these as CUMULATIVE+DISTRIBUTION / CUMULATIVE
# +INT64, and Cloud Monitoring's `condition_threshold` aligners
# (ALIGN_PERCENTILE_99, ALIGN_SUM) don't accept those metric kinds. PromQL's
# `histogram_quantile` and `rate`/`increase` handle cumulative series
# natively, so the threshold is encoded directly in the query.
#
# Discipline going forward: if an alert fires repeatedly on normal traffic,
# loosen the threshold; if it never fires when something clearly went wrong,
# tighten it. All histograms are emitted with WithUnit("ms"), so the
# numeric comparison in each query is in milliseconds.
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
      **Runbook**: docs/runbooks/postgres-pool-exhaustion.md

      **HIGH**: apigateway's Postgres connection pool has ≥4 connections in use
      (default max is 5 via `DB_POOL_MAX_CONNS`). Sustained exhaustion causes
      request queueing and rising `postgres/query.duration` tails.

      Threshold verified 2026-05-16: 80% of `DB_POOL_MAX_CONNS=5` → fire at
      ≥4 in_use. 7-day observed max was 1 in_use; current capacity is
      heavily over-provisioned for single-user scale, but the alert exists
      to catch the moment that changes.

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
      **Runbook**: docs/runbooks/strava-api-latency.md

      **MEDIUM**: P99 Strava API call duration sustained above 1500ms for ≥10 minutes.
      Strava's own latency dominates here; if this fires often, check Strava's status
      page before assuming it's us.

      Threshold tuned 2026-05-16 from 7-day observed P99 of 747.5ms (worst
      `operation` label). 2× margin gives headroom for legitimate burstiness
      without page-fatigue. 1500 is mid-bucket [1000,2500] by design (2× worst-op
      P99) — re-derive from per-operation P99 before snapping it to a boundary.
    EOT
  }

  conditions {
    display_name = "strava/api.duration P99 > 1500ms"

    condition_prometheus_query_language {
      query               = <<-EOT
        histogram_quantile(0.99,
          sum by (le, metric_operation) (
            rate({__name__="workload.googleapis.com/desirelines.io/strava/api.duration_bucket", monitored_resource="generic_task"}[5m])
          )
        ) > 1500
      EOT
      duration            = "600s"
      evaluation_interval = "60s"
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
      **Runbook**: docs/runbooks/http-request-latency.md

      **MEDIUM**: P99 HTTP request duration (dispatcher + apigateway) sustained
      above 15s for ≥10 minutes.

      Threshold 15s, tuned 2026-05-31: the first histogram-bucket boundary above
      the ~10s scale-to-zero cold-start ceiling — boundary-aligned, so firing
      depends on bucket counts, not on coarse within-bucket interpolation. 7-day
      aggregate P99 is ~4.1s, P50 ~60ms; the tail is Cloud Run / Neon cold starts
      which spike a sparse-traffic window's P99 to ~10s. The alert `duration`
      (600s) is deliberately > the 5m rate window, so a single cold start clears
      the window before firing — only sustained degradation pages. Min-instance
      mitigation declined (keeps scale-to-zero cost savings).

      **Action**:
      1. Cold-start burst (isolated spikes on low traffic) vs sustained?
      2. If sustained: check Cloud Run / Neon health and recent deploys.
    EOT
  }

  conditions {
    display_name = "http/request.duration P99 > 15000ms"

    condition_prometheus_query_language {
      query               = <<-EOT
        histogram_quantile(0.99,
          sum by (le) (
            rate({__name__="workload.googleapis.com/desirelines.io/http/request.duration_bucket", monitored_resource="generic_task"}[5m])
          )
        ) > 15000
      EOT
      duration            = "600s"
      evaluation_interval = "60s"
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
      **Runbook**: docs/runbooks/postgres-query-latency.md

      **MEDIUM**: P99 Postgres query duration sustained above 15s for ≥10
      minutes. Typical queries are fast (~50ms; indexed lookups).

      Threshold 15s, tuned 2026-05-31: the first histogram-bucket boundary above
      the ~10s scale-to-zero cold-start ceiling — boundary-aligned, so firing
      depends on bucket counts, not on coarse within-bucket interpolation. 7-day
      aggregate P99 is ~4.3s; the tail is Neon scale-to-zero compute wake on the
      first query after idle, which spikes a sparse-traffic window's P99 to ~10s.
      The alert `duration` (600s) is deliberately > the 5m rate window, so a
      single wake clears the window before firing — only sustained degradation
      pages. Always-on Neon declined (keeps scale-to-zero cost savings).

      **Action**:
      1. Isolated Neon wake (spikes on low traffic) vs sustained slow queries?
      2. If sustained: inspect slow queries (missing index, lock contention) and recent migrations.
    EOT
  }

  conditions {
    display_name = "postgres/query.duration P99 > 15000ms"

    condition_prometheus_query_language {
      query               = <<-EOT
        histogram_quantile(0.99,
          sum by (le, metric_operation) (
            rate({__name__="workload.googleapis.com/desirelines.io/postgres/query.duration_bucket", monitored_resource="generic_task"}[5m])
          )
        ) > 15000
      EOT
      duration            = "600s"
      evaluation_interval = "60s"
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
      **Runbook**: docs/runbooks/firestore-operation-latency.md

      **MEDIUM**: P99 Firestore operation duration sustained above 1000ms for ≥10 minutes.

      Threshold confirmed 2026-05-16 from 7-day observed P99 of 492.5ms (worst
      `operation` label). 2× observed = ~1000ms, which is what the initial
      placeholder happened to already be set to.
    EOT
  }

  conditions {
    display_name = "firestore/operation.duration P99 > 1000ms"

    condition_prometheus_query_language {
      query               = <<-EOT
        histogram_quantile(0.99,
          sum by (le, metric_operation) (
            rate({__name__="workload.googleapis.com/desirelines.io/firestore/operation.duration_bucket", monitored_resource="generic_task"}[5m])
          )
        ) > 1000
      EOT
      duration            = "600s"
      evaluation_interval = "60s"
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
      **Runbook**: docs/runbooks/pubsub-publish-latency.md

      **MEDIUM**: P99 PubSub publish duration sustained above 500ms for ≥10 minutes.
      Publish should be sub-100ms typically; sustained slowness here blocks the
      dispatcher's webhook response path.

      Threshold tuned 2026-05-16 from 7-day observed P99 of 248.5ms. 2× margin
      gives headroom for legitimate burstiness without page-fatigue.
    EOT
  }

  conditions {
    display_name = "pubsub/publish.duration P99 > 500ms"

    condition_prometheus_query_language {
      query               = <<-EOT
        histogram_quantile(0.99,
          sum by (le) (
            rate({__name__="workload.googleapis.com/desirelines.io/pubsub/publish.duration_bucket", monitored_resource="generic_task"}[5m])
          )
        ) > 500
      EOT
      duration            = "600s"
      evaluation_interval = "60s"
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
      **Runbook**: docs/runbooks/webhook-events-absent.md

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
    display_name = "webhook_events count = 0 over 24h"

    condition_prometheus_query_language {
      # `or on() vector(0)` provides a 0 fallback when the time series is
      # absent from the 24h window (e.g., service down long enough that no
      # datapoints exist). Without it, `sum(increase(...))` returns an empty
      # vector when there's no data, and `empty < 1` is itself empty, so the
      # alert would silently not fire on the worst-case scenario. The outer
      # parens are required: `<` binds tighter than `or`, so without them
      # the `< 1` would attach to `vector(0)` only, producing a vector that
      # always fires.
      query               = <<-EOT
        (
          sum(
            increase({__name__="workload.googleapis.com/desirelines.io/webhook/events", monitored_resource="generic_task"}[24h])
          )
          or on() vector(0)
        ) < 1
      EOT
      duration            = "0s"
      evaluation_interval = "300s"
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

# Alert-shape convention for `webhook_owner_check_*`:
#   duration=0s  → single event (use when one occurrence is the signal).
#   duration > 0 → sustained rate (use when one-offs are noise).

# Alert-shape convention for the owner_check alerts below:
#
#   - duration = "0s" + trigger { count = 1 }  → fire on the FIRST event.
#     For one-shot signals where a single occurrence is the whole story
#     (orphan tokens here; unknown_sport_type_detected in monitoring.tf).
#
#   - duration > "0s", default trigger         → sustained-rate gate.
#     For operational noise filters where only a persistent condition is
#     actionable (owner_check_error below; latency and error-rate alerts).
#
# Picking the wrong shape fails silently — a one-shot signal behind a
# sustained-rate gate is an alert that never fires. The mechanism: ALIGN_RATE
# turns a single counter increment into a non-zero rate for one alignment
# window only, then back to zero. Any duration longer than that window
# therefore demands consecutive events across multiple windows, which a
# one-shot signal by definition never produces.

# HIGH: Orphan tokens — an allowlisted athlete's webhook arrived but the
# dispatcher had no Firestore tokens for them. This indicates real data loss
# (Firestore wipe, deauth/re-auth race, partial migration) rather than the
# expected stray-webhook case. Distinct from STRAVA_FETCH_FAILED 5xx alerts
# because the dispatcher acks orphans with 200 to stop Strava retries — the
# orphan condition is ONLY visible via this counter label. Fires on the
# first event; orphan is a one-shot signal.
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
      **Runbook**: docs/runbooks/webhook-owner-check-orphan.md

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

      **Alert shape**: authored to fire on the FIRST orphan event — orphan is
      a one-shot signal of real data loss, not a sustained-rate condition. Do
      not raise `duration` above `0s`. ALIGN_RATE turns one event into a
      non-zero rate for a single 60s window, so any longer duration would
      require orphan events in consecutive minutes and this alert would never
      fire on the failure mode it exists to catch. Compare
      `webhook_owner_check_error` (sustained-rate, MEDIUM) and
      `unknown_sport_type_detected` in monitoring.tf (the single-event
      template).
    EOT
  }

  conditions {
    display_name = "owner_check{result=orphan} > 0 (single event)"

    condition_threshold {
      filter          = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/owner_check\" AND resource.type=\"generic_task\" AND metric.labels.result=\"orphan\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      # Explicit rather than implicit: GCP defaults to count = 1, so this
      # changes no behavior. It states the single-event intent in the code so
      # the pairing with duration = "0s" reads as deliberate, matching
      # unknown_sport_type_detected.
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
      **Runbook**: docs/runbooks/webhook-owner-check-error.md

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
      filter   = "metric.type=\"workload.googleapis.com/desirelines.io/webhook/owner_check\" AND resource.type=\"generic_task\" AND metric.labels.result=\"error\""
      duration = "600s"
      # `ALIGN_RATE` aligns counter increments into events-per-second, so a
      # "rate > 1/min" intent becomes 1/60 = 0.01667. The pre-2026-05-12
      # value of `1` was actually requiring 60 errors/min — 60× too high —
      # which made the alert silently false-negative since it was authored.
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01667

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
