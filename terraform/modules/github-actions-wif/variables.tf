# GitHub Actions Workload Identity Federation - Variables

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod, etc.)"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in format 'owner/repo' (e.g., 'andy-esch/desirelines')"
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "GitHub repository must be in format 'owner/repo'"
  }
}

variable "github_repository_owner" {
  description = "GitHub repository owner (extracted from github_repository if not provided)"
  type        = string
  default     = ""
}

# Workload Identity Pool configuration
variable "pool_id" {
  description = "Workload Identity Pool ID"
  type        = string
  default     = "github-actions"
}

variable "pool_display_name" {
  description = "Display name for Workload Identity Pool"
  type        = string
  default     = "GitHub Actions Pool"
}

# Workload Identity Provider configuration
variable "provider_id" {
  description = "Workload Identity Provider ID"
  type        = string
  default     = "github-oidc"
}

variable "provider_display_name" {
  description = "Display name for Workload Identity Provider"
  type        = string
  default     = "GitHub OIDC Provider"
}

# Service Account configuration
variable "service_account_id" {
  description = "Service account ID for GitHub Actions deployments"
  type        = string
  default     = "github-actions-deploy"
}

variable "service_account_display_name" {
  description = "Display name for deployment service account"
  type        = string
  default     = "GitHub Actions Deployment"
}

# Pool creation control (set false to reuse existing pool)
variable "create_pool" {
  description = "Whether to create the WIF pool and provider (set false to reuse existing)"
  type        = bool
  default     = true
}

variable "workload_identity_pool_name" {
  description = "Full resource name of existing WIF pool (required when create_pool=false)"
  type        = string
  default     = ""
}

# Additional IAM roles
variable "additional_project_roles" {
  description = "Additional project-level IAM roles to grant the service account"
  type        = list(string)
  default     = []
}
