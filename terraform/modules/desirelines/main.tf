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

# Data sources for secrets
data "google_secret_manager_secret_version" "strava_auth" {
  secret = "strava-auth-${var.environment}"
}

# Local variables for resource naming
locals {
  # Consistent naming conventions using project ID for global uniqueness
  dataset_name = var.project_name
  bucket_name  = "${var.gcp_project_id}-${var.project_name}-aggregation"

  # Parse Strava auth JSON secret
  strava_auth = jsondecode(data.google_secret_manager_secret_version.strava_auth.secret_data)

  # Common resource labels (GCP labels only allow lowercase letters, numbers, hyphens, underscores)
  common_labels = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
    component   = "desirelines"
    repository  = "andy-esch-desirelines"
    team        = "platform"
  }

  # Function source configuration (local or external bucket)
  function_source_bucket = var.external_function_source_bucket != null ? var.external_function_source_bucket : google_storage_bucket.function_source[0].name

  # Function source object names
  dispatcher_object_name  = "dispatcher-${var.function_source_tag}.zip"
  bq_inserter_object_name = "bq-inserter-${var.function_source_tag}.zip"
  aggregator_object_name  = "aggregator-${var.function_source_tag}.zip"
  api_gateway_object_name = "api-gateway-${var.function_source_tag}.zip"
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
    for_each = var.create_dev_service_accounts ? [google_service_account.aggregator_dev[0].email] : [var.service_account_email]
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

# Cloud Storage Bucket for aggregated data
# Available in both "full" and "data-only" modes for storing chart data
resource "google_storage_bucket" "aggregation_bucket" {
  name          = local.bucket_name
  location      = var.storage_location
  force_destroy = var.environment != "prod"

  labels = local.common_labels

  # Uniform bucket-level access (no ACLs)
  uniform_bucket_level_access = true

  # Versioning for data protection
  versioning {
    enabled = var.environment == "prod"
  }

  # Lifecycle rules for cost optimization
  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }
}

# Cloud Storage Bucket for function source packages (only created if not using external bucket)
resource "google_storage_bucket" "function_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name          = "${var.gcp_project_id}-function-source"
  location      = var.storage_location
  force_destroy = var.environment != "prod"

  labels = local.common_labels

  # Uniform bucket-level access (no ACLs)
  uniform_bucket_level_access = true

  # Lifecycle rules for source package cleanup
  lifecycle_rule {
    condition {
      age = 30 # Keep source packages for 30 days
    }
    action {
      type = "Delete"
    }
  }
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
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "dispatcher"
  display_name = "Desirelines Dispatcher (${title(var.environment)})"
  description  = "Service account for dispatcher function in ${var.environment} environment"
}

resource "google_service_account" "aggregator_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "aggregator"
  display_name = "Desirelines Aggregator (${title(var.environment)})"
  description  = "Service account for aggregator function in ${var.environment} environment"
}

resource "google_service_account" "bq_inserter_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "bq-inserter"
  display_name = "Desirelines BQ Inserter (${title(var.environment)})"
  description  = "Service account for BQ inserter function in ${var.environment} environment"
}

resource "google_service_account" "api_gateway_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "api-gateway"
  display_name = "Desirelines API Gateway (${title(var.environment)})"
  description  = "Service account for API gateway function in ${var.environment} environment"
}

# IAM permissions for dispatcher (PubSub Publisher only)
resource "google_pubsub_topic_iam_member" "dispatcher_publisher" {
  count  = var.create_dev_service_accounts ? 1 : 0
  topic  = google_pubsub_topic.activity_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.dispatcher_dev[0].email}"
}

# IAM permissions for aggregator (Storage Admin + BigQuery read access - PubSub permissions handled by Eventarc)

resource "google_storage_bucket_iam_member" "aggregator_storage" {
  count  = var.create_dev_service_accounts ? 1 : 0
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
  member     = var.create_dev_service_accounts ? "serviceAccount:${google_service_account.aggregator_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

resource "google_project_iam_member" "aggregator_bigquery_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = var.create_dev_service_accounts ? "serviceAccount:${google_service_account.aggregator_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

# IAM permissions for BQ inserter (BigQuery Data Editor only - PubSub permissions handled by Eventarc)

resource "google_bigquery_dataset_iam_member" "bq_inserter_data_editor" {
  count      = var.create_dev_service_accounts ? 1 : 0
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

resource "google_project_iam_member" "bq_inserter_bigquery_data_editor" {
  count   = var.create_dev_service_accounts ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

resource "google_project_iam_member" "bq_inserter_bigquery_job_user" {
  count   = var.create_dev_service_accounts ? 1 : 0
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

# IAM permissions for API Gateway (Storage Object Viewer only - read aggregated data)
resource "google_storage_bucket_iam_member" "api_gateway_storage" {
  count  = var.create_dev_service_accounts ? 1 : 0
  bucket = google_storage_bucket.aggregation_bucket.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api_gateway_dev[0].email}"
}

# Service Account Impersonation permissions (allows your user to impersonate the service accounts)
resource "google_service_account_iam_member" "dispatcher_impersonation" {
  count              = var.create_dev_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.dispatcher_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "aggregator_impersonation" {
  count              = var.create_dev_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.aggregator_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "bq_inserter_impersonation" {
  count              = var.create_dev_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.bq_inserter_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

resource "google_service_account_iam_member" "api_gateway_impersonation" {
  count              = var.create_dev_service_accounts && var.developer_email != null ? 1 : 0
  service_account_id = google_service_account.api_gateway_dev[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.developer_email}"
}

# Secret Manager IAM permissions for service accounts

# Dispatcher access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "dispatcher_strava_auth_access" {
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = var.create_dev_service_accounts ? "serviceAccount:${google_service_account.dispatcher_dev[0].email}" : "serviceAccount:${var.service_account_email}"
}

# Aggregator access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "aggregator_strava_auth_access" {
  count     = var.create_dev_service_accounts ? 1 : 0
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.aggregator_dev[0].email}"
}

# BQ Inserter access to Strava auth secret
resource "google_secret_manager_secret_iam_member" "bq_inserter_strava_auth_access" {
  count     = var.create_dev_service_accounts ? 1 : 0
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

# ==============================================================================
# Artifact Registry
# ==============================================================================

# Artifact Registry repository for container images (shared across environments)
resource "google_artifact_registry_repository" "functions" {
  location      = var.artifact_registry_location
  repository_id = "${var.project_name}-functions"
  description   = "Container registry for desirelines functions (all environments)"
  format        = "DOCKER"

  labels = merge(local.common_labels, {
    shared_resource = "true"
  })
}

# ==============================================================================
# Function Source Storage Objects
# ==============================================================================

# Upload function source packages to Cloud Storage (only when using local bucket)
resource "google_storage_bucket_object" "dispatcher_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name   = "dispatcher-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source[0].name
  source = "${path.module}/../../../dist/dispatcher-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "bq_inserter_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name   = "bq-inserter-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source[0].name
  source = "${path.module}/../../../dist/bq-inserter-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "aggregator_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name   = "aggregator-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source[0].name
  source = "${path.module}/../../../dist/aggregator-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "api_gateway_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name   = "api-gateway-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source[0].name
  source = "${path.module}/../../../dist/api-gateway-${var.function_source_tag}.zip"
}

# ==============================================================================
# CLOUD FUNCTIONS (Only created in "full" deployment mode)
# ==============================================================================

# Activity Dispatcher (Go Function - Source Package)
# Only created when deployment_mode = "full"
# In "data-only" mode, functions run locally in Docker containers
resource "google_cloudfunctions2_function" "activity_dispatcher" {
  count       = var.deployment_mode == "full" ? 1 : 0
  name        = "${var.project_name}_dispatcher"
  location    = var.gcp_region
  description = "Activity dispatcher - webhook receiver (${var.environment})"

  build_config {
    runtime           = "go125"
    entry_point       = "ActivityDispatcher"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = local.function_source_bucket
        object = local.dispatcher_object_name
      }
    }
  }

  service_config {
    max_instance_count    = 1
    min_instance_count    = 0
    available_memory      = "128Mi"
    timeout_seconds       = 60
    service_account_email = var.create_dev_service_accounts ? google_service_account.dispatcher_dev[0].email : var.service_account_email

    environment_variables = {
      GCP_PROJECT_ID   = var.gcp_project_id
      GCP_PUBSUB_TOPIC = google_pubsub_topic.activity_events.name
      ENVIRONMENT      = var.environment
      LOG_LEVEL        = "INFO"
      FORCE_DEPLOY     = "20250925-secret-update-v1"
    }

    # Mount Strava secrets as volume
    secret_volumes {
      mount_path = "/etc/secrets"
      project_id = var.gcp_project_id
      secret     = "strava-auth-${var.environment}"
      versions {
        version = "latest"
        path    = "strava_auth.json"
      }
    }
  }

  labels = local.common_labels
}

# Allow unauthenticated access to dispatcher (required for Strava webhooks)
resource "google_cloud_run_service_iam_member" "dispatcher_public_access" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloudfunctions2_function.activity_dispatcher[0].service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_cloudfunctions2_function.activity_dispatcher]
}

# Allow unauthenticated access to API Gateway (required for web app access)
resource "google_cloud_run_service_iam_member" "api_gateway_public_access" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloudfunctions2_function.api_gateway[0].service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_cloudfunctions2_function.api_gateway]
}

# Activity BQ Inserter (Python Function - Source Package)
resource "google_cloudfunctions2_function" "activity_bq_inserter" {
  count       = var.deployment_mode == "full" ? 1 : 0
  name        = "${var.project_name}_bq_inserter"
  location    = var.gcp_region
  description = "Activity BigQuery inserter (${var.environment})"

  build_config {
    runtime           = "python313"
    entry_point       = "main"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = local.function_source_bucket
        object = local.bq_inserter_object_name
      }
    }
  }

  service_config {
    max_instance_count    = 1
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 540
    service_account_email = var.create_dev_service_accounts ? google_service_account.bq_inserter_dev[0].email : var.service_account_email
    ingress_settings      = "ALLOW_INTERNAL_ONLY"

    environment_variables = {
      GCP_PROJECT_ID       = var.gcp_project_id
      GCP_BIGQUERY_DATASET = google_bigquery_dataset.activities_dataset.dataset_id
      GCP_BIGQUERY_TABLE   = google_bigquery_table.activities.table_id
      ENVIRONMENT          = var.environment
      LOG_LEVEL            = "INFO"
      FORCE_REDEPLOY       = "2025-09-19-new-strava-scope-v1"
    }

    # Mount Strava secrets as volume
    secret_volumes {
      mount_path = "/etc/secrets"
      project_id = var.gcp_project_id
      secret     = "strava-auth-${var.environment}"
      versions {
        version = "latest"
        path    = "strava_auth.json"
      }
    }
  }

  event_trigger {
    trigger_region = var.gcp_region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.activity_events.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  labels = local.common_labels
}

# Activity Aggregator (Python Function - Source Package)
resource "google_cloudfunctions2_function" "activity_aggregator" {
  count       = var.deployment_mode == "full" ? 1 : 0
  name        = "${var.project_name}_aggregator"
  location    = var.gcp_region
  description = "Activity aggregator and storage writer (${var.environment})"

  build_config {
    runtime           = "python313"
    entry_point       = "main"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = local.function_source_bucket
        object = local.aggregator_object_name
      }
    }
  }

  service_config {
    max_instance_count    = 1
    min_instance_count    = 0
    available_memory      = "512Mi"
    timeout_seconds       = 540
    service_account_email = var.create_dev_service_accounts ? google_service_account.aggregator_dev[0].email : var.service_account_email
    ingress_settings      = "ALLOW_INTERNAL_ONLY"


    environment_variables = {
      GCP_PROJECT_ID  = var.gcp_project_id
      GCP_BUCKET_NAME = google_storage_bucket.aggregation_bucket.name
      ENVIRONMENT     = var.environment
      LOG_LEVEL       = "INFO"
      FORCE_REDEPLOY  = "2025-09-19-new-strava-scope-v1"
    }

    # Mount Strava secrets as volume
    secret_volumes {
      mount_path = "/etc/secrets"
      project_id = var.gcp_project_id
      secret     = "strava-auth-${var.environment}"
      versions {
        version = "latest"
        path    = "strava_auth.json"
      }
    }
  }

  event_trigger {
    trigger_region = var.gcp_region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.activity_events.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }

  labels = local.common_labels
}

# API Gateway (Go Function - Source Package)
resource "google_cloudfunctions2_function" "api_gateway" {
  count       = var.deployment_mode == "full" ? 1 : 0
  name        = "${var.project_name}_api_gateway"
  location    = var.gcp_region
  description = "API gateway for serving activity data (${var.environment})"

  build_config {
    runtime           = "go125"
    entry_point       = "APIGateway"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = local.function_source_bucket
        object = local.api_gateway_object_name
      }
    }
  }

  service_config {
    max_instance_count             = 10
    min_instance_count             = 0
    available_memory               = "128Mi"
    timeout_seconds                = 60
    service_account_email          = var.create_dev_service_accounts ? google_service_account.api_gateway_dev[0].email : var.service_account_email
    ingress_settings               = "ALLOW_INTERNAL_ONLY"
    all_traffic_on_latest_revision = true

    environment_variables = {
      GCP_PROJECT_ID  = var.gcp_project_id
      GCP_BUCKET_NAME = google_storage_bucket.aggregation_bucket.name
      ENVIRONMENT     = var.environment
    }
  }

  labels = local.common_labels
}

# NOTE: Function source packages managed by google_storage_bucket_object resources above
