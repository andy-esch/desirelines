# Production environment configuration

terraform {
  required_version = ">= 1.12"

  # Production uses remote state storage
  # Configure backend with: terraform init -backend-config=backend.tfvars
  backend "gcs" {
    prefix = "environments/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Configure the Google Cloud Provider
provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# Use the desirelines module
module "desirelines" {
  source = "../../modules/desirelines"

  # Environment-specific configuration
  project_name       = "desirelines"
  environment        = "prod"
  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  gcp_region         = var.gcp_region

  # Shared artifacts project (single source of truth for container images)
  external_artifact_registry = "us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services"

  # Production settings
  bigquery_location = "US"

  # Enable APIs
  enable_apis = true

  # Deployment version configuration (used for Cloud Run images)
  deployment_version = var.deployment_version

  # Developer access
  developer_email = var.developer_email

  # API Gateway CORS configuration (production domains only)
  api_gateway_allowed_origins = "https://desirelines-prod.web.app,https://desirelines.andyes.ch"

  # Infisical configuration
  infisical_project_id = "99dc2cfc-d853"
}

# Get project for IAM configuration
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# ==============================================================================
# GitHub Actions CI/CD Infrastructure
# ==============================================================================

module "github_actions" {
  source = "../../modules/github-actions-wif"

  project_id        = var.gcp_project_id
  environment       = "prod"
  github_repository = var.github_repository

  # Use different pool name to avoid soft-deleted resource conflicts
  pool_id     = "github-actions-cicd"
  provider_id = "github-oidc-provider"
}

# DLQ subscriptions and IAM permissions are now managed by the desirelines module
# in pubsub_subscriptions.tf. This provides:
# - Consistent naming across environments
# - DLQ configured from creation (not post-hoc)
# - Full Terraform lifecycle management
