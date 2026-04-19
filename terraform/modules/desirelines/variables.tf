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
}

# Optional variables with sensible defaults

variable "enable_apis" {
  description = "Whether to enable required GCP APIs"
  type        = bool
  default     = true
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
  })
  default = {
    log_level = "INFO"
  }
}
