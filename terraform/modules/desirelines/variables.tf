# Variables for the Desirelines module

variable "project_name" {
  description = "Name of the project (used for resource naming)"
  type        = string
  default     = "desirelines"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]*[a-z0-9]$", var.project_name))
    error_message = "Project name must start with a letter, contain only lowercase letters, numbers, and underscores, and end with a letter or number."
  }
}

variable "environment" {
  description = "Environment name (local, dev, prod)"
  type        = string

  validation {
    condition     = contains(["local", "dev", "prod"], var.environment)
    error_message = "Environment must be one of: local, dev, prod."
  }
}

variable "gcp_project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "gcp_project_number" {
  description = "Google Cloud Project Number (needed for service account IAM)"
  type        = string
}

variable "gcp_region" {
  description = "Default GCP region"
  type        = string
  default     = "us-central1"
}

variable "bigquery_location" {
  description = "BigQuery dataset location"
  type        = string
  default     = "US"
}

variable "firestore_location" {
  description = "Firestore database location (region ID, e.g., 'us-central1')"
  type        = string
  default     = "us-central1"
}

variable "developer_email" {
  description = "Email of the developer account for BigQuery console access (optional)"
  type        = string
  default     = null
}

variable "slack_notification_channel_id" {
  description = "Full resource ID of an externally-managed Slack notification channel (format: projects/<project>/notificationChannels/<id>). Created once via GCP Console → Monitoring → Notification Channels → Slack OAuth flow; the channel is not managed by Terraform because the OAuth token is issued through the Console and kept out of state. Leave null to skip Slack notifications for this environment."
  type        = string
  default     = null

  validation {
    condition     = var.slack_notification_channel_id == null || can(regex("^projects/[^/]+/notificationChannels/[0-9]+$", var.slack_notification_channel_id))
    error_message = "slack_notification_channel_id must be a full resource ID in the format: projects/<project>/notificationChannels/<id>."
  }
}

# Optional variables with sensible defaults

variable "enable_apis" {
  description = "Whether to enable required GCP APIs"
  type        = bool
  default     = true
}

variable "enable_application_metric_alerts" {
  description = "Gate for alert policies that reference custom OTel application metrics (postgres pool exhaustion, Strava/HTTP/Postgres/Firestore/PubSub latency tails). These policies target custom.googleapis.com/desirelines.io/* metric descriptors, which are auto-created by the OTel GCP exporter the first time the app emits each metric — so on a first-ever deploy they don't exist yet and `google_monitoring_alert_policy` returns 404 when it tries to bind to them. Leave false on the initial deploy; after the services have run long enough to flush at least one metrics batch (≥ 60s), flip true on a follow-up apply."
  type        = bool
  default     = false
}

# Deployment version tracking for code provenance and observability
variable "deployment_version" {
  description = "Version tag for all deployed code (Cloud Run images and Cloud Function source packages). Typically a git SHA for code provenance and observability (e.g., 'b30d6ea' or 'latest')"
  type        = string
  default     = "latest"

  validation {
    condition     = can(regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$", var.deployment_version))
    error_message = "deployment_version must be a valid Docker tag: start with alphanumeric, contain only alphanumeric/dots/hyphens/underscores, max 128 characters."
  }
}

# Per-service image digests, resolved from tags by the deploy pipeline.
#
# WHY THIS EXISTS: `deployment_version` is a git SHA, so the image reference string
# changes on every commit even when the built bytes are identical. Terraform diffs the
# string and creates a new Cloud Run revision for every service on every push — a real
# traffic-shifting rollout for a service that did not change. Referencing an immutable
# digest instead makes Terraform's own diff engine the guard: same bytes, no diff, no
# revision.
#
# This is about deploy churn, not supply-chain immutability — Cloud Run already resolves
# a tag to a digest and pins each revision to it.
#
# Empty (the default) falls back to tag-based references, which preserves local/manual
# `terraform apply`. The deploy pipeline is expected to always populate it; if it stops,
# the no-op revisions come back silently.
variable "image_digests" {
  description = "Map of service name (dispatcher/apigateway/stravapipe) to image digest, e.g. {dispatcher = \"sha256:abc...\"}. Empty falls back to tag-based image references."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for d in values(var.image_digests) : can(regex("^sha256:[a-f0-9]{64}$", d))])
    error_message = "Each image digest must be a full sha256 digest, e.g. 'sha256:' followed by 64 lowercase hex characters."
  }

  validation {
    condition     = alltrue([for k in keys(var.image_digests) : contains(["dispatcher", "apigateway", "stravapipe"], k)])
    error_message = "image_digests keys must be one of: dispatcher, apigateway, stravapipe."
  }
}

variable "external_artifact_registry" {
  description = "Artifact Registry URL for container images. Format: REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+/.+$", var.external_artifact_registry))
    error_message = "external_artifact_registry is required and must match REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME format."
  }
}

variable "api_gateway_allowed_origins" {
  description = "Comma-separated list of allowed CORS origins for API Gateway"
  type        = string
  default     = ""
}

variable "readiness_probe_schedule" {
  description = "Cron schedule (UTC) for the Cloud Scheduler /api/ready probe against apigateway. Default is hourly. Each invocation wakes Neon's compute for the 5-min idle window, so this is the dominant DB-active driver after stealth wakes are removed. NOTE: dropping below hourly requires retuning google_monitoring_alert_policy.apigateway_readiness_failing — its 4h alignment window assumes ≥3 hourly samples per evaluation; reducing cadence balloons alert latency."
  type        = string
  default     = "0 * * * *"
}

variable "infisical_project_id" {
  description = "Infisical Project ID (used as suffix for integration Service Account)"
  type        = string
}

# ==============================================================================
# Application Config (sourced from Infisical at deploy time)
# ==============================================================================
# These values are fetched from Infisical by the calling environment and passed
# to the module. This keeps Infisical as the single source of truth for app config.

variable "app_config" {
  description = "Application configuration values from Infisical"
  type = object({
    log_level         = string
    frontend_url      = optional(string, "")
    auth_callback_url = optional(string, "")
    # Dispatcher Firestore-lookup cache TTLs (Go duration strings, e.g. "5m").
    # "0" disables the respective cache — the incident kill switch for a suspected
    # staleness bug, settable via GitOps with no code change.
    dispatcher_allowlist_cache_ttl = optional(string, "5m")
    dispatcher_token_cache_ttl     = optional(string, "5m")
  })
  default = {
    log_level = "INFO"
  }
}
