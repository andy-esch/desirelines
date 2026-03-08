# GitHub Actions Workload Identity Federation
# Enables GitHub Actions to authenticate to GCP without service account keys
# Reference: https://cloud.google.com/iam/docs/workload-identity-federation

terraform {
  required_version = ">= 1.12"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

# ==============================================================================
# Local Variables
# ==============================================================================

locals {
  # Extract repository owner from "owner/repo" format
  repository_owner = var.github_repository_owner != "" ? var.github_repository_owner : split("/", var.github_repository)[0]

  # Use created pool name or provided existing pool name
  pool_name = var.create_pool ? google_iam_workload_identity_pool.github_actions[0].name : var.workload_identity_pool_name
}

# ==============================================================================
# Workload Identity Pool
# ==============================================================================

resource "google_iam_workload_identity_pool" "github_actions" {
  count                     = var.create_pool ? 1 : 0
  workload_identity_pool_id = var.pool_id
  display_name              = var.pool_display_name
  description               = "Workload Identity Pool for GitHub Actions CI/CD"
  disabled                  = false
}

# ==============================================================================
# Workload Identity Provider (GitHub OIDC)
# ==============================================================================

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.create_pool ? 1 : 0
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_actions[0].workload_identity_pool_id
  workload_identity_pool_provider_id = var.provider_id
  display_name                       = var.provider_display_name
  description                        = "GitHub OIDC provider for ${var.github_repository}"

  # GitHub's OIDC issuer
  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.actor"            = "assertion.actor"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
  }

  # Restrict to specific GitHub organization
  attribute_condition = "assertion.repository_owner == '${local.repository_owner}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ==============================================================================
# Service Account for Deployments
# ==============================================================================

resource "google_service_account" "github_actions_deploy" {
  account_id   = var.service_account_id
  display_name = var.service_account_display_name
  description  = "Service account for GitHub Actions deployments to ${var.environment}"
}

# ==============================================================================
# IAM Bindings - Allow GitHub Actions to impersonate service account
# ==============================================================================

# Allow GitHub Actions from specified repository to impersonate service account
resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_actions_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool_name}/attribute.repository/${var.github_repository}"
}

# ==============================================================================
# GCP Permissions for Deployment Service Account
#
# SECURITY PRINCIPLE: CI/CD deploys applications, NOT infrastructure
# - GitHub Actions can deploy new code versions
# - GitHub Actions CANNOT modify IAM policies or create resources
# - Infrastructure changes require Terraform apply via the deploy repo's
#   ci-deploy SA, which gets broader roles via additional_project_roles
# ==============================================================================

# Cloud Run Developer - Deploy new revisions of existing services
resource "google_project_iam_member" "run_developer" {
  count   = var.grant_default_roles ? 1 : 0
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Artifact Registry Writer - Push Docker images
resource "google_project_iam_member" "artifact_registry_writer" {
  count   = var.grant_default_roles ? 1 : 0
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Service Account User - Required to deploy services that run as other SAs
resource "google_project_iam_member" "service_account_user" {
  count   = var.grant_default_roles ? 1 : 0
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Viewer - Read-only access to verify deployments
resource "google_project_iam_member" "viewer" {
  count   = var.grant_default_roles ? 1 : 0
  project = var.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Firebase Hosting Admin - Deploy web frontend to Firebase Hosting
resource "google_project_iam_member" "firebase_hosting_admin" {
  count   = var.grant_default_roles ? 1 : 0
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# ==============================================================================
# Additional Project-Level Roles (configurable per invocation)
# ==============================================================================

resource "google_project_iam_member" "additional_roles" {
  for_each = toset(var.additional_project_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}
