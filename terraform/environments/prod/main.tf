# Production environment configuration

terraform {
  required_version = ">= 1.12"

  # Production uses remote state storage
  backend "gcs" {
    bucket = "desirelines-prod-terraform-state"
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

  # Cross-project sharing (use dev as single source of truth for artifacts)
  external_function_source_bucket = "desirelines-dev-function-source"
  external_artifact_registry      = "us-central1-docker.pkg.dev/desirelines-dev/desirelines-functions"

  # Production settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use default compute service account (only as fallback if dedicated SAs not created)
  service_account_email = "${var.gcp_project_number}-compute@developer.gserviceaccount.com"

  # Enable APIs and create service accounts
  enable_apis                       = true
  create_service_accounts           = true # Create terraform and infrastructure service accounts
  create_dedicated_service_accounts = true # Use dedicated SAs per function (least privilege)

  # Deployment version configuration (used for both Cloud Run images and Cloud Function source packages)
  deployment_version = var.deployment_version

  # Use "full" mode for complete cloud deployment
  # This creates all resources: Cloud Functions, PubSub, BigQuery, Storage, etc.
  deployment_mode = "full"

  # Developer access
  developer_email = var.developer_email

  # API Gateway CORS configuration (production domains only)
  api_gateway_allowed_origins = "https://desirelines-prod.web.app,https://desirelines.andyes.ch"
}

# ===================================================================
# Dead Letter Queue Monitoring Subscriptions
# ===================================================================
# These subscriptions allow us to monitor and debug failed messages

# Get project for IAM configuration
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# Import existing Eventarc subscriptions
import {
  to = google_pubsub_subscription.bq_inserter_eventarc
  id = "projects/desirelines-prod/subscriptions/eventarc-us-central1-desirelines-bq-inserter-960936-sub-360"
}

# BQ Inserter Eventarc subscription with DLQ
resource "google_pubsub_subscription" "bq_inserter_eventarc" {
  name  = "eventarc-us-central1-desirelines-bq-inserter-960936-sub-360"
  topic = module.desirelines.pubsub_topic_name

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  ack_deadline_seconds = 600 # 10 minutes (matches current Eventarc config)
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
    environment = "prod"
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
    environment = "prod"
  }
}

# ===================================================================
# IAM Permissions for Dead Letter Queue
# ===================================================================

# Pub/Sub service account needs permission to publish to dead letter topic
resource "google_pubsub_topic_iam_member" "pubsub_sa_publish_deadletter" {
  topic  = module.desirelines.pubsub_dead_letter_topic_name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

