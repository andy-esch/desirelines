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
  create_service_accounts     = true  # Enabled for clean dev environment setup
  create_dev_service_accounts = true  # Create runtime service accounts

  # Function deployment configuration
  function_source_tag = var.function_source_tag


  # Developer access
  developer_email = var.developer_email
}

# Import and manage Eventarc-created subscriptions to configure dead letter queues
# These subscriptions are automatically created by Eventarc but need DLQ configuration

# Import Eventarc BQ inserter subscription
import {
  to = google_pubsub_subscription.eventarc_bq_inserter
  id = "projects/${var.gcp_project_id}/subscriptions/eventarc-us-central1-desirelines-bq-inserter-dev-661759-sub-662"
}

resource "google_pubsub_subscription" "eventarc_bq_inserter" {
  name  = "eventarc-us-central1-desirelines-bq-inserter-dev-661759-sub-662"
  topic = module.desirelines.pubsub_topic_name

  # Dead letter policy configuration
  dead_letter_policy {
    dead_letter_topic     = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
    max_delivery_attempts = 5
  }

  # Retry policy (matches current Eventarc settings)
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Ignore push config as it's managed by Eventarc
  lifecycle {
    ignore_changes = [push_config]
  }
}

# Import Eventarc aggregator subscription
import {
  to = google_pubsub_subscription.eventarc_aggregator
  id = "projects/${var.gcp_project_id}/subscriptions/eventarc-us-central1-desirelines-aggregator-dev-126476-sub-255"
}

resource "google_pubsub_subscription" "eventarc_aggregator" {
  name  = "eventarc-us-central1-desirelines-aggregator-dev-126476-sub-255"
  topic = module.desirelines.pubsub_topic_name

  # Dead letter policy configuration
  dead_letter_policy {
    dead_letter_topic     = "projects/${var.gcp_project_id}/topics/${module.desirelines.pubsub_dead_letter_topic_name}"
    max_delivery_attempts = 5
  }

  # Retry policy (matches current Eventarc settings)
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Ignore push config as it's managed by Eventarc
  lifecycle {
    ignore_changes = [push_config]
  }
}
