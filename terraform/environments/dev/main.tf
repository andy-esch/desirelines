# Development environment configuration

terraform {
  required_version = ">= 1.12"

  # Development uses remote state storage
  # Configure backend with: terraform init -backend-config="bucket=your-terraform-state-bucket"
  backend "gcs" {
    prefix = "environments/dev"
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
  environment        = "dev"
  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  gcp_region         = var.gcp_region

  # Development settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use default compute service account initially (will be replaced with dedicated SAs)
  service_account_email = "${var.gcp_project_number}-compute@developer.gserviceaccount.com"

  # Enable APIs and create service accounts
  enable_apis                       = true
  create_service_accounts           = true # Enabled for clean dev environment setup
  create_dedicated_service_accounts = true # Use dedicated SAs per function (least privilege)

  # Deployment version configuration (used for both Cloud Run images and Cloud Function source packages)
  deployment_version = var.deployment_version

  # Use "full" mode for complete cloud deployment
  # This creates all resources: Cloud Functions, PubSub, BigQuery, Storage, etc.
  deployment_mode = "full"

  # Developer access
  developer_email = var.developer_email

  # API Gateway CORS configuration
  api_gateway_allowed_origins = "https://desirelines-dev.web.app,http://localhost:5173"
}

# Get project details for IAM configuration
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# ==============================================================================
# GitHub Actions CI/CD Infrastructure
# ==============================================================================

module "github_actions" {
  source = "../../modules/github-actions-wif"

  project_id        = var.gcp_project_id
  environment       = "dev"
  github_repository = var.github_repository

  # Use different pool name to avoid soft-deleted resource
  pool_id     = "github-actions-cicd"
  provider_id = "github-oidc-provider"
}

# ===================================================================
# Dead Letter Queue Subscriptions
# ===================================================================
# These subscriptions allow monitoring and debugging of failed messages.
# Eventarc triggers (created by the module) deliver to Cloud Run services.
# Failed messages are sent to the dead letter topic.

# Dead letter subscription for BQ inserter service
resource "google_pubsub_subscription" "bq_inserter_dlq" {
  name  = "desirelines-bq-inserter-dlq"
  topic = module.desirelines.pubsub_dead_letter_topic_name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  labels = {
    purpose     = "dead-letter-queue"
    service     = "bq-inserter"
    environment = "dev"
  }
}

# Dead letter subscription for postgres-writer service
resource "google_pubsub_subscription" "postgres_writer_dlq" {
  name  = "desirelines-postgres-writer-dlq"
  topic = module.desirelines.pubsub_dead_letter_topic_name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  labels = {
    purpose     = "dead-letter-queue"
    service     = "postgres-writer"
    environment = "dev"
  }
}

# ===================================================================
# IAM Permissions for Dead Letter Queue
# ===================================================================

# Allow Pub/Sub service account to publish to dead letter topic
resource "google_pubsub_topic_iam_member" "pubsub_sa_publish_deadletter" {
  topic  = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# ===================================================================
# Cross-Project Artifact Registry Access (for prod)
# ===================================================================
# Allow prod project's Cloud Run service agent to pull images from dev's registry.
# This enables single-source-of-truth for container images across environments.

variable "prod_project_number" {
  description = "Production project number for cross-project Artifact Registry access"
  type        = string
  default     = null
}

resource "google_artifact_registry_repository_iam_member" "prod_cloud_run_reader" {
  count = var.prod_project_number != null ? 1 : 0

  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = module.desirelines.artifact_registry_repository
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${var.prod_project_number}@serverless-robot-prod.iam.gserviceaccount.com"
}

