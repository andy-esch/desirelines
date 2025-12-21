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

# Get project for IAM configuration
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# ===================================================================
# Import Blocks for Existing Resources
# ===================================================================
# These resources exist in GCP but are missing from Terraform state.
# After successful apply, these import blocks can be removed.

# --- Core Infrastructure ---
import {
  to = module.desirelines.google_storage_bucket.aggregation_bucket
  id = "desirelines-prod-desirelines-aggregation"
}

import {
  to = module.desirelines.google_artifact_registry_repository.functions
  id = "projects/desirelines-prod/locations/us-central1/repositories/desirelines-functions"
}

# --- BigQuery ---
import {
  to = module.desirelines.google_bigquery_dataset.activities_dataset
  id = "projects/desirelines-prod/datasets/desirelines"
}

import {
  to = module.desirelines.google_bigquery_table.activities
  id = "projects/desirelines-prod/datasets/desirelines/tables/activities"
}

import {
  to = module.desirelines.google_bigquery_table.activities_staging
  id = "projects/desirelines-prod/datasets/desirelines/tables/activities_staging"
}

import {
  to = module.desirelines.google_bigquery_table.deleted_activities
  id = "projects/desirelines-prod/datasets/desirelines/tables/deleted_activities"
}

# --- PubSub ---
import {
  to = module.desirelines.google_pubsub_topic.activity_events
  id = "projects/desirelines-prod/topics/desirelines_activity_events"
}

import {
  to = module.desirelines.google_pubsub_topic.dead_letter
  id = "projects/desirelines-prod/topics/desirelines_dead_letter"
}

# --- Firestore ---
import {
  to = module.desirelines.google_firestore_database.user_configs
  id = "projects/desirelines-prod/databases/(default)"
}

# --- Firebase Hosting Custom Domain ---
import {
  to = module.desirelines.google_firebase_hosting_custom_domain.app_subdomain[0]
  id = "projects/desirelines-prod/sites/desirelines-prod/customDomains/desirelines.andyes.ch"
}

# --- Service Accounts ---
import {
  to = module.desirelines.google_service_account.dispatcher_dev[0]
  id = "projects/desirelines-prod/serviceAccounts/dispatcher@desirelines-prod.iam.gserviceaccount.com"
}

import {
  to = module.desirelines.google_service_account.bq_inserter_dev[0]
  id = "projects/desirelines-prod/serviceAccounts/bq-inserter@desirelines-prod.iam.gserviceaccount.com"
}

import {
  to = module.desirelines.google_service_account.api_gateway_dev[0]
  id = "projects/desirelines-prod/serviceAccounts/api-gateway@desirelines-prod.iam.gserviceaccount.com"
}

# --- Cloud Run Services ---
import {
  to = module.desirelines.google_cloud_run_v2_service.dispatcher[0]
  id = "projects/desirelines-prod/locations/us-central1/services/desirelines-dispatcher"
}

import {
  to = module.desirelines.google_cloud_run_v2_service.api_gateway[0]
  id = "projects/desirelines-prod/locations/us-central1/services/desirelines-api-gateway"
}

import {
  to = module.desirelines.google_cloud_run_v2_service.bq_inserter[0]
  id = "projects/desirelines-prod/locations/us-central1/services/desirelines-bq-inserter"
}

# Note: postgres-writer Cloud Run service may not exist yet (new service)

# --- Eventarc Subscription (managed outside module) ---
import {
  to = google_pubsub_subscription.bq_inserter_eventarc
  id = "projects/desirelines-prod/subscriptions/eventarc-us-central1-desirelines-bq-inserter-812734-sub-457"
}

# ===================================================================
# Dead Letter Queue Monitoring Subscriptions
# ===================================================================
# These subscriptions allow us to monitor and debug failed messages.

# BQ Inserter Eventarc subscription with DLQ
resource "google_pubsub_subscription" "bq_inserter_eventarc" {
  name  = "eventarc-us-central1-desirelines-bq-inserter-812734-sub-457"
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

