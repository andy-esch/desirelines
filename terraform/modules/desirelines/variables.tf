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

variable "storage_location" {
  description = "Cloud Storage bucket location"
  type        = string
  default     = "US"
}

variable "service_account_email" {
  description = "Service account email for resource access"
  type        = string
}

variable "developer_email" {
  description = "Email of the developer account for BigQuery console access (optional)"
  type        = string
  default     = null
}

# Optional variables with sensible defaults

variable "enable_apis" {
  description = "Whether to enable required GCP APIs"
  type        = bool
  default     = true
}

variable "create_service_accounts" {
  description = "Whether to create dedicated service accounts"
  type        = bool
  default     = true
}

variable "create_dev_service_accounts" {
  description = "Whether to create development service accounts for local development"
  type        = bool
  default     = false
}

# Container image variables for Cloud Functions
variable "function_image_tag" {
  description = "Tag for function container images (e.g., 'latest', 'v1.0.0', git SHA) - DEPRECATED: Use function_source_tag"
  type        = string
  default     = "latest"
}

variable "function_source_tag" {
  description = "Git SHA tag for function source packages (e.g., git SHA)"
  type        = string
  default     = "latest"
}

variable "artifact_registry_location" {
  description = "Location for Artifact Registry repository"
  type        = string
  default     = "us-central1"
}
