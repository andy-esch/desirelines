# Desirelines Core Infrastructure Module
# This module creates all the core GCP resources needed for the desirelines project

terraform {
  required_version = ">= 1.12"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

# Local variables for resource naming
locals {
  # Consistent naming conventions using project ID for global uniqueness
  dataset_name = var.project_name
  bucket_name  = "${var.gcp_project_id}-${var.project_name}-aggregation"

  # Common resource labels (GCP labels only allow lowercase letters, numbers, hyphens, underscores)
  common_labels = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
    component   = "desirelines"
    repository  = "andy-esch-desirelines"
    team        = "platform"
  }
}

# ==============================================================================
# API Enablement
# ==============================================================================

# Enable required Google Cloud APIs
resource "google_project_service" "required_apis" {
  for_each = var.enable_apis ? toset([
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com"
  ]) : []

  project = var.gcp_project_id
  service = each.value

  disable_dependent_services = false
  disable_on_destroy         = false
}

# ==============================================================================
# CORE DATA RESOURCES (Created in all deployment modes)
# ==============================================================================

# BigQuery Dataset
# Available in both "full" and "data-only" modes for storing activity data
resource "google_bigquery_dataset" "activities_dataset" {
  dataset_id    = local.dataset_name
  friendly_name = "Desirelines Activities Dataset (${title(var.environment)})"
  description   = "Dataset for storing Strava activity data - ${var.environment} environment"
  location      = var.bigquery_location

  labels = local.common_labels

  # Enable deletion protection for production
  delete_contents_on_destroy = var.environment != "prod"

  access {
    role          = "OWNER"
    user_by_email = var.service_account_email
  }

  # Optional developer access for BigQuery console
  dynamic "access" {
    for_each = var.developer_email != null ? [var.developer_email] : []
    content {
      role          = "OWNER"
      user_by_email = access.value
    }
  }

  # Aggregator service account access (read-only for delete operations)
  dynamic "access" {
    for_each = var.create_dedicated_service_accounts ? [google_service_account.aggregator_dev[0].email] : [var.service_account_email]
    content {
      role          = "READER"
      user_by_email = access.value
    }
  }
}

# BigQuery Table for Activities
resource "google_bigquery_table" "activities" {
  dataset_id          = google_bigquery_dataset.activities_dataset.dataset_id
  table_id            = "activities"
  friendly_name       = "Strava Activities"
  description         = "Complete Strava activity data matching production schema"
  deletion_protection = var.environment == "prod"

  labels = local.common_labels

  # Schema will be loaded from JSON file
  schema = jsonencode(jsondecode(file("${path.module}/../../../schemas/bigquery/activities_full.json")).schema)

  # Partitioning by date for better performance
  time_partitioning {
    type  = "DAY"
    field = "start_date"
  }

  # Clustering for query optimization
  clustering = ["sport_type", "start_date"]
}

# BigQuery Staging Table for Activities (used for upsert operations)
resource "google_bigquery_table" "activities_staging" {
  dataset_id          = google_bigquery_dataset.activities_dataset.dataset_id
  table_id            = "activities_staging"
  friendly_name       = "Strava Activities Staging"
  description         = "Staging table for activities upsert operations - temporary data before merge to main table"
  deletion_protection = false # Staging table should be easily recreatable
  labels              = local.common_labels

  # Same schema as main activities table
  schema = jsonencode(jsondecode(file("${path.module}/../../../schemas/bigquery/activities_full.json")).schema)

  # Same partitioning and clustering as main table for performance
  time_partitioning {
    type  = "DAY"
    field = "start_date"
  }

  clustering = ["sport_type", "start_date"]
}

# BigQuery Table for Deleted Activities (archive)
resource "google_bigquery_table" "deleted_activities" {
  dataset_id          = google_bigquery_dataset.activities_dataset.dataset_id
  table_id            = "deleted_activities"
  friendly_name       = "Deleted Strava Activities Archive"
  description         = "Archive of deleted Strava activities with deletion metadata - preserves data for audit trail"
  deletion_protection = var.environment == "prod"

  labels = merge(local.common_labels, {
    purpose = "archive"
  })

  # Schema includes all activity fields plus deletion metadata
  schema = jsonencode(jsondecode(file("${path.module}/../../../schemas/bigquery/deleted_activities.json")).schema)

  # Partition by deletion timestamp for efficient queries
  time_partitioning {
    type  = "DAY"
    field = "deleted_at"
  }

  # Clustering for query optimization (by when deleted and original activity date)
  clustering = ["deleted_at", "start_date"]
}

# ==============================================================================
# FIRESTORE DATABASE
# ==============================================================================

# Firestore database for user configuration data
# Stores user-specific frontend configs (goals, annotations, preferences)
resource "google_firestore_database" "user_configs" {
  project     = var.gcp_project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # Enable Point-in-Time Recovery for data protection
  point_in_time_recovery_enablement = var.environment == "prod" ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"

  # Deletion protection for production
  deletion_policy = var.environment == "prod" ? "DELETE_PROTECTION_STATE_ENABLED" : "DELETE_PROTECTION_STATE_DISABLED"

  # Depends on API being enabled
  depends_on = [google_project_service.required_apis]
}

# ==============================================================================
# PUBSUB RESOURCES
# ==============================================================================

# PubSub Topic for activity events
resource "google_pubsub_topic" "activity_events" {
  name = "${var.project_name}_activity_events"

  labels = local.common_labels

  # Message retention for 7 days
  message_retention_duration = "604800s"
}

# Eventarc-created subscriptions are managed at the root module level
# to configure dead letter queues. See the environment-specific main.tf files.

# Dead letter topic for failed messages
resource "google_pubsub_topic" "dead_letter" {
  name = "${var.project_name}_dead_letter"

  labels = local.common_labels

  # Longer retention for debugging
  message_retention_duration = "1209600s" # 14 days
}

# Dead letter topic subscription for monitoring failed messages
resource "google_pubsub_subscription" "dead_letter_monitoring" {
  name  = "${var.project_name}_dead_letter_monitoring"
  topic = google_pubsub_topic.dead_letter.name

  labels = local.common_labels

  # Longer retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600
}

# Grant PubSub service account permission to publish to dead letter topic
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  topic  = google_pubsub_topic.dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.gcp_project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Development Service Accounts (only created if enabled)
resource "google_service_account" "dispatcher_dev" {
  count        = var.create_dedicated_service_accounts ? 1 : 0
  account_id   = "dispatcher"
  display_name = "Desirelines Dispatcher (${title(var.environment)})"
  description  = "Service account for dispatcher function in ${var.environment} environment"
}

resource "google_service_account" "aggregator_dev" {
  count        = var.create_dedicated_service_accounts ? 1 : 0
  account_id   = "aggregator"
  display_name = "Desirelines Aggregator (${title(var.environment)})"
  description  = "Service account for aggregator function in ${var.environment} environment"
}

resource "google_service_account" "bq_inserter_dev" {
  count        = var.create_dedicated_service_accounts ? 1 : 0
  account_id   = "bq-inserter"
  display_name = "Desirelines BQ Inserter (${title(var.environment)})"
  description  = "Service account for BQ inserter function in ${var.environment} environment"
}

resource "google_service_account" "api_gateway_dev" {
  count        = var.create_dedicated_service_accounts ? 1 : 0
  account_id   = "api-gateway"
  display_name = "Desirelines API Gateway (${title(var.environment)})"
  description  = "Service account for API gateway function in ${var.environment} environment"
}

# IAM permissions for dispatcher (PubSub Publisher only)
resource "google_pubsub_topic_iam_member" "dispatcher_publisher" {
  count  = var.create_dedicated_service_accounts ? 1 : 0
  topic  = google_pubsub_topic.activity_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.dispatcher_dev[0].email}"
}

# IAM permissions for aggregator (Storage Admin + BigQuery read access - PubSub permissions handled by Eventarc)

resource "google_storage_bucket_iam_member" "aggregator_storage" {
  count  = var.create_dedicated_service_accounts ? 1 : 0
  bucket = google_storage_bucket.aggregation_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.aggregator_dev[0].email}"
}

# BigQuery permissions for aggregator (needed for delete event handling)
# Aggregator needs to query BigQuery to get activity metadata for distance calculations
# NOTE: If implementing activity-indexed summary structure (see refactor-summary-structure-activity-indexed.md),
#       these permissions can be removed as aggregator will no longer need BigQuery access
resource "google_bigquery_dataset_iam_member" "aggregator_data_viewer" {
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = var.create_dedicated_service_accounts ? "serviceAccount:${google_service_account.aggregator_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

resource "google_project_iam_member" "aggregator_bigquery_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = var.create_dedicated_service_accounts ? "serviceAccount:${google_service_account.aggregator_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

# IAM permissions for BQ inserter (BigQuery Data Editor only - PubSub permissions handled by Eventarc)

resource "google_bigquery_dataset_iam_member" "bq_inserter_data_editor" {
  count      = var.create_dedicated_service_accounts ? 1 : 0
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

resource "google_project_iam_member" "bq_inserter_bigquery_data_editor" {
  count   = var.create_dedicated_service_accounts ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

resource "google_project_iam_member" "bq_inserter_bigquery_job_user" {
  count   = var.create_dedicated_service_accounts ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

# IAM permissions for API Gateway (Storage Object Viewer only - read aggregated data)
resource "google_storage_bucket_iam_member" "api_gateway_storage" {
  count  = var.create_dedicated_service_accounts ? 1 : 0
  bucket = google_storage_bucket.aggregation_bucket.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api_gateway_dev[0].email}"
}

# Grant Firebase Admin permissions to API Gateway for token verification
resource "google_project_iam_member" "api_gateway_firebase_admin" {
  count   = var.create_dedicated_service_accounts ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/firebase.admin"
  member  = "serviceAccount:${google_service_account.api_gateway_dev[0].email}"
}

# Service Account Impersonation permissions (allows your user to impersonate the service accounts)
resource "google_service_account_iam_member" "dispatcher_impersonation" {
  count              = var.create_dedicated_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.dispatcher_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "aggregator_impersonation" {
  count              = var.create_dedicated_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.aggregator_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "bq_inserter_impersonation" {
  count              = var.create_dedicated_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.bq_inserter_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "api_gateway_impersonation" {
  count              = var.create_dedicated_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.api_gateway_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

# Secret Manager IAM permissions for service accounts

# Dispatcher access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "dispatcher_strava_auth_access" {
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = var.create_dedicated_service_accounts ? "serviceAccount:${google_service_account.dispatcher_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

# Aggregator access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "aggregator_strava_auth_access" {
  count     = var.create_dedicated_service_accounts ? 1 : 0
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.aggregator_dev[0].email}"
}

# BQ Inserter access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "bq_inserter_strava_auth_access" {
  count     = var.create_dedicated_service_accounts ? 1 : 0
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

# Grant developer access to secrets for local development
resource "google_secret_manager_secret_iam_member" "strava_auth_developer_access" {
  count     = var.developer_email != null ? 1 : 0
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "user:${var.developer_email}"
}

# PostgreSQL secret access permissions

# TODO (CLAUDE): add postgresql connection string access for postgres writer too

# API Gateway access to PostgreSQL connection string
resource "google_secret_manager_secret_iam_member" "api_gateway_postgres_access" {
  count     = var.create_dedicated_service_accounts ? 1 : 0
  secret_id = "postgres-connection-string-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_gateway_dev[0].email}"
}

# Grant developer access to PostgreSQL secret for local development
resource "google_secret_manager_secret_iam_member" "postgres_developer_access" {
  count     = var.developer_email != null ? 1 : 0
  secret_id = "postgres-connection-string-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "user:${var.developer_email}"
}

# ==============================================================================
# Artifact Registry
# ==============================================================================

# Artifact Registry repository for container images (shared across environments)
resource "google_artifact_registry_repository" "functions" {
  location      = var.artifact_registry_location
  repository_id = "${var.project_name}-functions"
  description   = "Container registry for desirelines functions (all environments)"
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

  labels = merge(local.common_labels, {
    shared_resource = "true"
  })
}

