# Local development environment configuration

terraform {
  required_version = ">= 1.12"

  # State will be stored locally for development
  # backend "gcs" {
  #   bucket = "desirelines-terraform-state"
  #   prefix = "environments/local"
  # }

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
  environment        = "local"
  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  gcp_region         = var.gcp_region

  # Use dev bucket for function sources (no need to build locally)
  external_function_source_bucket = "desirelines-dev-function-source"

  # Local development settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use default compute service account initially (will be replaced with dedicated SAs)
  service_account_email = "${var.gcp_project_number}-compute@developer.gserviceaccount.com"

  # Enable APIs but skip service accounts for local development
  enable_apis                 = true
  create_service_accounts     = false # Not needed - using user credentials
  create_dev_service_accounts = false # Not needed - using user credentials

  # Function deployment configuration
  function_source_tag = var.function_source_tag

  # Use "data-only" mode for hybrid local development
  # This creates only BigQuery + Storage resources that Docker containers write to
  # Cloud Functions, PubSub, etc. are handled by local Docker Compose setup
  deployment_mode = "data-only"

  # Developer access
  developer_email = var.developer_email
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
    environment = "local"
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
    environment = "local"
  }
}

# Note: Eventarc automatically creates and manages the main subscriptions
# that trigger the functions. We only manage the dead letter queue subscriptions
# for monitoring and debugging failed messages.
