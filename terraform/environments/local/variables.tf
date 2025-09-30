# Variables for local environment

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

variable "developer_email" {
  description = "Email address for BigQuery console access (optional)"
  type        = string
  default     = null
}

variable "function_source_tag" {
  description = "Git SHA or tag for function source packages"
  type        = string
  default     = "latest"
}
