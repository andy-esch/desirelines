# GitHub Actions Workload Identity Federation
# Enables GitHub Actions to authenticate to GCP without service account keys
# Reference: https://cloud.google.com/iam/docs/workload-identity-federation

terraform {
  required_version = ">= 1.12"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# ==============================================================================
# Local Variables
# ==============================================================================

locals {
  # Extract repository owner from "owner/repo" format
  repository_owner = var.github_repository_owner != "" ? var.github_repository_owner : split("/", var.github_repository)[0]
}

# ==============================================================================
# Workload Identity Pool
# ==============================================================================

resource "google_iam_workload_identity_pool" "github_actions" {
  workload_identity_pool_id = var.pool_id
  display_name              = var.pool_display_name
  description               = "Workload Identity Pool for GitHub Actions CI/CD"
  disabled                  = false
}

# ==============================================================================
# Workload Identity Provider (GitHub OIDC)
# ==============================================================================

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_actions.workload_identity_pool_id
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
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_actions.name}/attribute.repository/${var.github_repository}"
}

# ==============================================================================
# GCP Permissions for Deployment Service Account
#
# SECURITY PRINCIPLE: CI/CD deploys applications, NOT infrastructure
# - GitHub Actions can deploy new code versions
# - GitHub Actions CANNOT modify IAM policies or create resources
# - Infrastructure changes require manual terraform apply by admin
# ==============================================================================

# Cloud Run Developer - Deploy new revisions of existing services
resource "google_project_iam_member" "run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Artifact Registry Writer - Push Docker images
resource "google_project_iam_member" "artifact_registry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Storage Object Admin - Terraform state and assets
resource "google_project_iam_member" "storage_object_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Service Account User - Required to deploy services that run as other SAs
resource "google_project_iam_member" "service_account_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Viewer - Read-only access to verify deployments
resource "google_project_iam_member" "viewer" {
  project = var.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# ==============================================================================
# Additional Read Permissions for Terraform State Refresh
# Terraform needs to read current state of all resources before applying changes
# ==============================================================================

# Secret Manager Secret Accessor - Read secrets (Terraform data sources)
resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Pub/Sub Admin - Manage Pub/Sub topics, subscriptions, and their IAM policies
# Required for Terraform to manage dead letter topic IAM bindings
resource "google_project_iam_member" "pubsub_admin" {
  project = var.project_id
  role    = "roles/pubsub.admin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# BigQuery Admin - Manage datasets, tables, and data (needed for Terraform state refresh)
# Note: Terraform refreshes all resources in state, even with -target flags
# Requires 'admin' role because updating dataset metadata needs bigquery.datasets.update
resource "google_project_iam_member" "bigquery_admin" {
  project = var.project_id
  role    = "roles/bigquery.admin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Security Reviewer - Read IAM policies without modifying them
# Required for Terraform to refresh state of IAM bindings
resource "google_project_iam_member" "security_reviewer" {
  project = var.project_id
  role    = "roles/iam.securityReviewer"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Service Account Admin - Manage IAM policies on service accounts
# Required for Terraform to manage service account IAM bindings (e.g., infisical sync)
resource "google_project_iam_member" "service_account_admin" {
  project = var.project_id
  role    = "roles/iam.serviceAccountAdmin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}

# Firebase Hosting Admin - Deploy web frontend to Firebase Hosting
resource "google_project_iam_member" "firebase_hosting_admin" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.github_actions_deploy.email}"
}
