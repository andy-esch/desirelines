variable "gcp_project_id" {
  description = "The artifacts project ID"
  type        = string
  default     = "desirelines-artifacts"
}

variable "gcp_region" {
  description = "GCP region for Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "dev_project_number" {
  description = "Project number for desirelines-dev (for Cloud Run service agent IAM)"
  type        = string
}

variable "prod_project_number" {
  description = "Project number for desirelines-prod (for Cloud Run service agent IAM)"
  type        = string
}

variable "github_actions_sa_email" {
  description = "GitHub Actions service account email (from dev project WIF) that can push images"
  type        = string
}

variable "ci_deploy_sa_emails" {
  description = "CI deploy service account emails (dev + prod) that need reader access to pull images"
  type        = list(string)
  default     = []
}
