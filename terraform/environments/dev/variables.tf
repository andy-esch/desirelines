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

variable "function_source_tag" {
  description = "Git SHA tag for function source packages"
  type        = string
}



variable "developer_email" {
  description = "Developer email for BigQuery console access"
  type        = string
  sensitive   = true
}
