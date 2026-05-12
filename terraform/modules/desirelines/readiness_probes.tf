# ============================================================================
# Hourly Readiness Probes (Cloud Scheduler → /ready)
# ============================================================================
# DB-touching readiness probes for apigateway + three Python Cloud Run
# services. Cloud Scheduler (single region, hourly) is used instead of
# uptime checks because uptime checks fan out across ~6 probe regions at
# a 15-min minimum cadence, which would keep Neon's compute awake
# continuously.
#
# Two readiness families share the same hourly cadence (var.readiness_probe_schedule)
# so all probes land in one Neon wake window — two probes per wake costs
# the same as one. Auth differs: apigateway is unauthenticated (fronted
# by Firebase Hosting), Python services require an OIDC token signed by
# a dedicated scheduler SA with roles/run.invoker.
#
# Adding a new Python service: append one entry to
# `local.python_readiness_targets`. The for_each-driven IAM, scheduler,
# log metric filter, and shared alert all extend automatically.
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
