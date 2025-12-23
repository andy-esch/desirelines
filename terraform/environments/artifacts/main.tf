# Shared Artifacts Project
# This project hosts the Artifact Registry used by all environments (dev, prod)

terraform {
  required_version = ">= 1.12"

  backend "gcs" {
    bucket = "desirelines-artifacts-terraform-state"
    prefix = "terraform/state"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# Artifact Registry for Docker images
resource "google_artifact_registry_repository" "services" {
  location      = var.gcp_region
  repository_id = "desirelines-services"
  description   = "Container registry for desirelines Cloud Run services (shared across all environments)"
  format        = "DOCKER"

  # Cleanup policy: keep only last 5 versions of each image
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  labels = {
    project    = "desirelines"
    managed_by = "terraform"
    purpose    = "shared-artifacts"
  }
}

# ==============================================================================
# IAM: Allow dev project to pull images
# ==============================================================================
resource "google_artifact_registry_repository_iam_member" "dev_pull" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${var.dev_project_number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ==============================================================================
# IAM: Allow prod project to pull images
# ==============================================================================
resource "google_artifact_registry_repository_iam_member" "prod_pull" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${var.prod_project_number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ==============================================================================
# IAM: Allow GitHub Actions to push images
# ==============================================================================
# This uses Workload Identity Federation from the dev project
# The GitHub Actions workflow authenticates via WIF and needs writer access
resource "google_artifact_registry_repository_iam_member" "github_actions_push" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${var.github_actions_sa_email}"
}
