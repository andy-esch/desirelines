# Variables for live (production) environment

variable "gcp_project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "gcp_project_number" {
  description = "Google Cloud Project Number (for default service account)"
  type        = string
}

variable "gcp_region" {
  description = "Default GCP region"
  type        = string
  default     = "us-central1"
}

variable "deployment_version" {
  description = "Version tag for all deployed code (typically a git SHA for code provenance)"
  type        = string
}

variable "developer_email" {
  description = "Developer email for BigQuery console access"
  type        = string
  sensitive   = true
}
