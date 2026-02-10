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
      version = "~> 7.0"
    }
  }
}

# Local variables for resource naming
locals {
  # Consistent naming conventions using project ID for global uniqueness
  dataset_name = var.project_name

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
    "secretmanager.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "iamcredentials.googleapis.com",
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

  depends_on = [google_project_service.required_apis]
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
  name        = "${var.project_name}-user-configs"
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

  depends_on = [google_project_service.required_apis]
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

# Grant PubSub service account permission to ack messages from source subscriptions
# Required for dead letter forwarding: without this, DLQ delivery silently fails
# and messages retry indefinitely instead of being forwarded after max_delivery_attempts
resource "google_pubsub_subscription_iam_member" "dlq_subscriber" {
  for_each = toset([
    google_pubsub_subscription.bq_inserter.name,
    google_pubsub_subscription.postgres_writer.name,
  ])

  subscription = each.value
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${var.gcp_project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# ==============================================================================
# Service Accounts (per-service for least privilege)
# ==============================================================================

resource "google_service_account" "dispatcher" {
  account_id   = "dispatcher"
  display_name = "Desirelines Dispatcher (${title(var.environment)})"
  description  = "Service account for dispatcher function in ${var.environment} environment"
}

resource "google_service_account" "bq_inserter" {
  account_id   = "bq-inserter"
  display_name = "Desirelines BQ Inserter (${title(var.environment)})"
  description  = "Service account for BQ inserter function in ${var.environment} environment"
}

resource "google_service_account" "api_gateway" {
  account_id   = "api-gateway"
  display_name = "Desirelines API Gateway (${title(var.environment)})"
  description  = "Service account for API gateway function in ${var.environment} environment"
}

resource "google_service_account" "postgres_writer" {
  account_id   = "postgres-writer"
  display_name = "Desirelines PostgreSQL Writer (${title(var.environment)})"
  description  = "Service account for PostgreSQL writer function in ${var.environment} environment"
}

# Infisical Integration Service Account
# Required for Secret Manager Sync. Suffix is determined by Infisical Project ID.
resource "google_service_account" "infisical_sync" {
  account_id   = "infisical-sync-${var.infisical_project_id}"
  display_name = "Infisical Secret Sync (${title(var.environment)})"
  description  = "Service account for Infisical to sync secrets to GCP Secret Manager"
}

# Grant Infisical permission to manage secrets (list, create, update, delete)
# Required "admin" role because Infisical needs to list secrets in the dashboard to link them.
resource "google_project_iam_member" "infisical_secret_admin" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.infisical_sync.email}"
}

# Grant Infisical permission to check enabled APIs
# Required for GCP App Connection setup in Infisical dashboard
resource "google_project_iam_member" "infisical_service_usage_admin" {
  project = var.gcp_project_id
  role    = "roles/serviceusage.serviceUsageAdmin"
  member  = "serviceAccount:${google_service_account.infisical_sync.email}"
}

# Grant Service Account Token Creator to the Infisical service account on itself for impersonation
resource "google_service_account_iam_member" "infisical_token_creator" {
  service_account_id = google_service_account.infisical_sync.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.infisical_sync.email}"
}

# Allow Infisical Cloud US to impersonate the sync service account
resource "google_service_account_iam_member" "infisical_cloud_impersonation" {
  service_account_id = google_service_account.infisical_sync.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:infisical-us@infisical-us.iam.gserviceaccount.com"
}

# ==============================================================================
# Service-Specific IAM Permissions
# ==============================================================================
# Per-service least-privilege IAM grants. Each service gets only the permissions
# it needs. PubSub subscriber permissions for Cloud Run services are handled
# automatically by Eventarc triggers (not managed here).

# Dispatcher publishes activity events to PubSub for downstream processing
# Flow: Strava webhook → Dispatcher → PubSub → BQ Inserter / Postgres Writer
resource "google_pubsub_topic_iam_member" "dispatcher_publisher" {
  topic  = google_pubsub_topic.activity_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.dispatcher.email}"
}

# IAM permissions for BQ inserter (BigQuery Data Editor only - PubSub permissions handled by Eventarc)

# Developer OWNER access for BigQuery console (optional)
# Allows developer to run ad-hoc queries, inspect tables, and manage data
# through the BigQuery console UI without using service accounts
resource "google_bigquery_dataset_iam_member" "developer_owner" {
  count      = var.developer_email != null ? 1 : 0
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  role       = "roles/bigquery.dataOwner"
  member     = "user:${var.developer_email}"
}

# BQ Inserter needs dataEditor on the dataset for insert/update/delete operations
resource "google_bigquery_dataset_iam_member" "bq_inserter_data_editor" {
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.bq_inserter.email}"
}

# BQ Inserter needs jobUser to run queries (required for MERGE operations)
resource "google_project_iam_member" "bq_inserter_bigquery_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.bq_inserter.email}"
}

# ==============================================================================
# Developer Service Account Impersonation
# ==============================================================================
# Allows developer to impersonate service accounts for local development/testing.
# This enables running Cloud Run services locally with production credentials,
# debugging permission issues, and testing IAM configurations without deploying.

resource "google_service_account_iam_member" "dispatcher_impersonation" {
  count              = var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.dispatcher.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "bq_inserter_impersonation" {
  count              = var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.bq_inserter.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "api_gateway_impersonation" {
  count              = var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.api_gateway.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "postgres_writer_impersonation" {
  count              = var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.postgres_writer.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

# ==============================================================================
# Infisical-Managed Secrets (Strava API)
# ==============================================================================
# Secret containers for Infisical sync. Terraform creates the container and IAM
# bindings; Infisical manages the secret values.
# Naming convention: INFISICAL_ prefix indicates provenance.

resource "google_secret_manager_secret" "strava_client_id" {
  secret_id = "INFISICAL_STRAVA_CLIENT_ID"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
  labels = { environment = var.environment, purpose = "strava-api", managed_by = "infisical" }
}

resource "google_secret_manager_secret" "strava_client_secret" {
  secret_id = "INFISICAL_STRAVA_CLIENT_SECRET"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
  labels = { environment = var.environment, purpose = "strava-api", managed_by = "infisical" }
}

resource "google_secret_manager_secret" "strava_refresh_token" {
  secret_id = "INFISICAL_STRAVA_REFRESH_TOKEN"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
  labels = { environment = var.environment, purpose = "strava-api", managed_by = "infisical" }
}

resource "google_secret_manager_secret" "strava_webhook_verify_token" {
  secret_id = "INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
  labels = { environment = var.environment, purpose = "strava-webhook", managed_by = "infisical" }
}

resource "google_secret_manager_secret" "strava_webhook_subscription_id" {
  secret_id = "INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID"
  project   = var.gcp_project_id
  replication {
    auto {}
  }
  labels = { environment = var.environment, purpose = "strava-webhook", managed_by = "infisical" }
}

# IAM Permissions for Atomic Secrets

# Dispatcher needs Webhook tokens
resource "google_secret_manager_secret_iam_member" "dispatcher_webhook_tokens" {
  for_each = toset([
    google_secret_manager_secret.strava_webhook_verify_token.secret_id,
    google_secret_manager_secret.strava_webhook_subscription_id.secret_id
  ])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dispatcher.email}"
}

# Dispatcher needs API tokens (to fetch activity data)
resource "google_secret_manager_secret_iam_member" "dispatcher_api_tokens" {
  for_each = toset([
    google_secret_manager_secret.strava_client_id.secret_id,
    google_secret_manager_secret.strava_client_secret.secret_id,
    google_secret_manager_secret.strava_refresh_token.secret_id
  ])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dispatcher.email}"
}

# ==============================================================================
# Infisical-Managed Secrets (PostgreSQL Connections)
# ==============================================================================
# Secret containers for Infisical sync. Terraform creates the container and IAM
# bindings; Infisical manages the secret values.
# Naming convention: INFISICAL_ prefix indicates provenance.

# Admin connection (for manual database management)
resource "google_secret_manager_secret" "postgres_conn_admin" {
  secret_id = "INFISICAL_POSTGRES_CONN_ADMIN"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    purpose     = "postgres-admin"
    managed_by  = "infisical"
  }
}

# Flyway connection (for schema migrations)
resource "google_secret_manager_secret" "postgres_conn_flyway" {
  secret_id = "INFISICAL_POSTGRES_CONN_FLYWAY"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    purpose     = "postgres-flyway"
    managed_by  = "infisical"
  }
}

# API Gateway connection (read-only access)
resource "google_secret_manager_secret" "postgres_conn_apigateway" {
  secret_id = "INFISICAL_POSTGRES_CONN_APIGATEWAY"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    purpose     = "postgres-apigateway"
    managed_by  = "infisical"
  }
}

# PostgreSQL Writer connection (read/write access)
resource "google_secret_manager_secret" "postgres_conn_writer" {
  secret_id = "INFISICAL_POSTGRES_CONN_WRITER"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    purpose     = "postgres-writer"
    managed_by  = "infisical"
  }
}

# Reader connection (generic read-only, for future services)
resource "google_secret_manager_secret" "postgres_conn_reader" {
  secret_id = "INFISICAL_POSTGRES_CONN_READER"
  project   = var.gcp_project_id

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    purpose     = "postgres-reader"
    managed_by  = "infisical"
  }
}

# ==============================================================================
# PostgreSQL Secret IAM Permissions
# ==============================================================================
# Each service has its own secret with least-privilege database role

# API Gateway access to its read-only PostgreSQL connection string
resource "google_secret_manager_secret_iam_member" "api_gateway_postgres_access" {
  project   = var.gcp_project_id
  secret_id = google_secret_manager_secret.postgres_conn_apigateway.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_gateway.email}"
}

# PostgreSQL Writer access to its read/write PostgreSQL connection string
resource "google_secret_manager_secret_iam_member" "postgres_writer_postgres_access" {
  project   = var.gcp_project_id
  secret_id = google_secret_manager_secret.postgres_conn_writer.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.postgres_writer.email}"
}

# Grant developer access to admin PostgreSQL secret for local development
resource "google_secret_manager_secret_iam_member" "postgres_developer_access" {
  count     = var.developer_email != null ? 1 : 0
  project   = var.gcp_project_id
  secret_id = google_secret_manager_secret.postgres_conn_admin.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "user:${var.developer_email}"
}

# ==============================================================================
# Artifact Registry
# ==============================================================================
# Container images are managed in the shared desirelines-artifacts project.
# See terraform/environments/artifacts/ for that configuration.
# The image URL is passed in via the external_artifact_registry variable.
