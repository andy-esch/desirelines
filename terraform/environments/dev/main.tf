# Development environment configuration

terraform {
  required_version = ">= 1.0"

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
  enable_apis                 = true
  create_service_accounts     = true # Enabled for clean dev environment setup
  create_dev_service_accounts = true # Create runtime service accounts

  # Function deployment configuration
  function_source_tag = var.function_source_tag

  # Use "full" mode for complete cloud deployment
  # This creates all resources: Cloud Functions, PubSub, BigQuery, Storage, etc.
  deployment_mode = "full"

  # Developer access
  developer_email = var.developer_email
}

# Get project details for IAM configuration
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# Dead Letter Queue Configuration for Eventarc-created subscriptions
# Eventarc creates subscriptions automatically - we create separate DLQ subscriptions

# Dead letter subscription for BQ inserter function
resource "google_pubsub_subscription" "bq_inserter_dlq" {
  name  = "desirelines-bq-inserter-dlq"
  topic = module.desirelines.pubsub_dead_letter_topic_name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  labels = {
    purpose     = "dead-letter-queue"
    function    = "bq-inserter"
    environment = "dev"
  }
}

# Dead letter subscription for aggregator function
resource "google_pubsub_subscription" "aggregator_dlq" {
  name  = "desirelines-aggregator-dlq"
  topic = module.desirelines.pubsub_dead_letter_topic_name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  labels = {
    purpose     = "dead-letter-queue"
    function    = "aggregator"
    environment = "dev"
  }
}

# Note: Eventarc automatically creates and manages the main subscriptions
# that trigger the functions. We only manage the dead letter queue subscriptions
# for monitoring and debugging failed messages.
# ===================================================================
# Eventarc Subscription Management with Dead Letter Queue
# ===================================================================
# Cloud Functions v2 with event_trigger automatically create Eventarc
# subscriptions. We import these subscriptions to add DLQ configuration.
# The ignore_changes lifecycle rule lets Eventarc continue managing
# the push_config while we manage the dead_letter_policy.

# Import existing Eventarc subscriptions (already imported, kept for documentation)
import {
  to = google_pubsub_subscription.bq_inserter_eventarc
  id = "projects/desirelines-dev/subscriptions/eventarc-us-central1-desirelines-bq-inserter-601502-sub-060"
}

import {
  to = google_pubsub_subscription.aggregator_eventarc
  id = "projects/desirelines-dev/subscriptions/eventarc-us-central1-desirelines-aggregator-696214-sub-050"
}

# BQ Inserter Eventarc subscription with DLQ
resource "google_pubsub_subscription" "bq_inserter_eventarc" {
  name  = "eventarc-us-central1-desirelines-bq-inserter-601502-sub-060"
  topic = module.desirelines.pubsub_topic_name

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  ack_deadline_seconds = 300 # 5 minutes for fast insert operation

  lifecycle {
    # Critical: Let Eventarc manage push configuration to avoid drift
    ignore_changes = [push_config]
  }

  labels = {
    managed-by  = "terraform"
    function    = "bq-inserter"
    environment = "dev"
  }
}

# Aggregator Eventarc subscription with DLQ
resource "google_pubsub_subscription" "aggregator_eventarc" {
  name  = "eventarc-us-central1-desirelines-aggregator-696214-sub-050"
  topic = module.desirelines.pubsub_topic_name

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  ack_deadline_seconds = 540 # 9 minutes for aggregation with API calls

  lifecycle {
    # Critical: Let Eventarc manage push configuration to avoid drift
    ignore_changes = [push_config]
  }

  labels = {
    managed-by  = "terraform"
    function    = "aggregator"
    environment = "dev"
  }
}

# ===================================================================
# IAM Permissions for Dead Letter Queue
# ===================================================================
# The Pub/Sub service account needs permission to:
# 1. Publish to the dead letter topic (when messages fail)
# 2. Subscribe to the Eventarc subscriptions (to read failed messages)

# Allow Pub/Sub service account to publish to dead letter topic
resource "google_pubsub_topic_iam_member" "pubsub_sa_publish_deadletter" {
  topic  = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Allow Pub/Sub service account to subscribe to BQ inserter subscription
resource "google_pubsub_subscription_iam_member" "bq_inserter_pubsub_sa_subscribe" {
  subscription = google_pubsub_subscription.bq_inserter_eventarc.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Allow Pub/Sub service account to subscribe to aggregator subscription
resource "google_pubsub_subscription_iam_member" "aggregator_pubsub_sa_subscribe" {
  subscription = google_pubsub_subscription.aggregator_eventarc.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
