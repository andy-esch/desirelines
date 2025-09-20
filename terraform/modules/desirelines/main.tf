# Desirelines Core Infrastructure Module
# This module creates all the core GCP resources needed for the desirelines project

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
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
  dataset_name = "${var.project_name}_dataset_${var.environment}"
  bucket_name  = "${var.gcp_project_id}-${var.project_name}-aggregation-${var.environment}"

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
    "cloudbuild.googleapis.com"
  ]) : []

  project = var.gcp_project_id
  service = each.value

  disable_dependent_services = false
  disable_on_destroy         = false
}

# ==============================================================================
# BigQuery Resources
# ==============================================================================

# BigQuery Dataset
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
  schema = jsonencode(jsondecode(file("${path.module}/../../../infrastructure/schemas/activities_full.json")).schema)

  # Partitioning by date for better performance
  time_partitioning {
    type  = "DAY"
    field = "start_date"
  }

  # Clustering for query optimization
  clustering = ["sport_type", "start_date"]
}

# Cloud Storage Bucket for aggregated data
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

# Cloud Storage Bucket for function source packages
resource "google_storage_bucket" "function_source" {
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

# PubSub Topic for activity events
resource "google_pubsub_topic" "activity_events" {
  name = "${var.project_name}_activity_events_${var.environment}"

  labels = local.common_labels

  # Message retention for 7 days
  message_retention_duration = "604800s"
}

# PubSub Subscription for BigQuery inserter
resource "google_pubsub_subscription" "bq_inserter" {
  name  = "${var.project_name}_bq_inserter_${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  labels = local.common_labels

  # Acknowledgment deadline
  ack_deadline_seconds = 300

  # Retry policy
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  # Dead letter policy
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

# PubSub Subscription for activity aggregator
resource "google_pubsub_subscription" "aggregator" {
  name  = "${var.project_name}_aggregator_${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  labels = local.common_labels

  # Acknowledgment deadline
  ack_deadline_seconds = 300

  # Retry policy
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }

  # Dead letter policy
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

# Dead letter topic for failed messages
resource "google_pubsub_topic" "dead_letter" {
  name = "${var.project_name}_dead_letter_${var.environment}"

  labels = local.common_labels

  # Longer retention for debugging
  message_retention_duration = "1209600s" # 14 days
}

# Development Service Accounts (only created if enabled)
resource "google_service_account" "dispatcher_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "dispatcher-${var.environment}"
  display_name = "Desirelines Dispatcher (${title(var.environment)})"
  description  = "Service account for dispatcher function in ${var.environment} environment"
}

resource "google_service_account" "aggregator_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "aggregator-${var.environment}"
  display_name = "Desirelines Aggregator (${title(var.environment)})"
  description  = "Service account for aggregator function in ${var.environment} environment"
}

resource "google_service_account" "bq_inserter_dev" {
  count        = var.create_dev_service_accounts ? 1 : 0
  account_id   = "bq-inserter-${var.environment}"
  display_name = "Desirelines BQ Inserter (${title(var.environment)})"
  description  = "Service account for BQ inserter function in ${var.environment} environment"
}

# IAM permissions for dispatcher (PubSub Publisher only)
resource "google_pubsub_topic_iam_member" "dispatcher_publisher" {
  count  = var.create_dev_service_accounts ? 1 : 0
  topic  = google_pubsub_topic.activity_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.dispatcher_dev[0].email}"
}

# IAM permissions for aggregator (PubSub Subscriber + Storage Admin)
resource "google_pubsub_subscription_iam_member" "aggregator_subscriber" {
  count        = var.create_dev_service_accounts ? 1 : 0
  subscription = google_pubsub_subscription.aggregator.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.aggregator_dev[0].email}"
}

resource "google_storage_bucket_iam_member" "aggregator_storage" {
  count  = var.create_dev_service_accounts ? 1 : 0
  bucket = google_storage_bucket.aggregation_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.aggregator_dev[0].email}"
}

# IAM permissions for BQ inserter (PubSub Subscriber + BigQuery Data Editor)
resource "google_pubsub_subscription_iam_member" "bq_inserter_subscriber" {
  count        = var.create_dev_service_accounts ? 1 : 0
  subscription = google_pubsub_subscription.bq_inserter.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.bq_inserter_dev[0].email}"
}

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

# Secret Manager IAM permissions for service accounts
resource "google_secret_manager_secret_iam_member" "strava_auth_access" {
  secret_id = "strava-auth-${var.environment}"
  role      = "roles/secretmanager.secretAccessor"
  member    = var.create_dev_service_accounts ? "serviceAccount:${google_service_account.dispatcher_dev[0].email}" : "serviceAccount:${var.service_account_email}"
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

# Upload function source packages to Cloud Storage
resource "google_storage_bucket_object" "dispatcher_source" {
  name   = "dispatcher-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source.name
  source = "${path.module}/../../../dist/dispatcher-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "bq_inserter_source" {
  name   = "bq-inserter-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source.name
  source = "${path.module}/../../../dist/bq-inserter-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "aggregator_source" {
  name   = "aggregator-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source.name
  source = "${path.module}/../../../dist/aggregator-${var.function_source_tag}.zip"
}

resource "google_storage_bucket_object" "api_gateway_source" {
  name   = "api-gateway-${var.function_source_tag}.zip"
  bucket = google_storage_bucket.function_source.name
  source = "${path.module}/../../../dist/api-gateway-${var.function_source_tag}.zip"
}

# ==============================================================================
# Cloud Functions (Source-based)
# ==============================================================================

# Activity Dispatcher (Go Function - Source Package)
resource "google_cloudfunctions2_function" "activity_dispatcher" {
  name        = "${var.project_name}_dispatcher_${var.environment}"
  location    = var.gcp_region
  description = "Activity dispatcher - webhook receiver (${var.environment})"

  build_config {
    runtime           = "go125"
    entry_point       = "ActivityDispatcher"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.dispatcher_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 10
    min_instance_count    = 0
    available_memory      = "128Mi"
    timeout_seconds       = 60
    service_account_email = var.create_dev_service_accounts ? google_service_account.dispatcher_dev[0].email : var.service_account_email

    environment_variables = {
      GCP_PROJECT_ID   = var.gcp_project_id
      GCP_PUBSUB_TOPIC = google_pubsub_topic.activity_events.name
      ENVIRONMENT      = var.environment
      LOG_LEVEL        = "INFO"
      FORCE_DEPLOY     = "20250919-v1"
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
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloudfunctions2_function.activity_dispatcher.service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_cloudfunctions2_function.activity_dispatcher]
}

# Allow unauthenticated access to API Gateway (required for web app access)
resource "google_cloud_run_service_iam_member" "api_gateway_public_access" {
  project  = var.gcp_project_id
  location = var.gcp_region
  service  = google_cloudfunctions2_function.api_gateway.service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [google_cloudfunctions2_function.api_gateway]
}

# Activity BQ Inserter (Python Function - Source Package)
resource "google_cloudfunctions2_function" "activity_bq_inserter" {
  name        = "${var.project_name}_bq_inserter_${var.environment}"
  location    = var.gcp_region
  description = "Activity BigQuery inserter (${var.environment})"

  build_config {
    runtime           = "python313"
    entry_point       = "main"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.bq_inserter_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 10
    min_instance_count    = 0
    available_memory      = "256Mi"
    timeout_seconds       = 540
    service_account_email = var.create_dev_service_accounts ? google_service_account.bq_inserter_dev[0].email : var.service_account_email

    environment_variables = {
      GCP_PROJECT_ID       = var.gcp_project_id
      GCP_BIGQUERY_DATASET = google_bigquery_dataset.activities_dataset.dataset_id
      GCP_BIGQUERY_TABLE   = google_bigquery_table.activities.table_id
      GCP_BQ_SUBSCRIPTION  = google_pubsub_subscription.bq_inserter.name
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
  }

  labels = local.common_labels
}

# Activity Aggregator (Python Function - Source Package)
resource "google_cloudfunctions2_function" "activity_aggregator" {
  name        = "${var.project_name}_aggregator_${var.environment}"
  location    = var.gcp_region
  description = "Activity aggregator and storage writer (${var.environment})"

  build_config {
    runtime           = "python313"
    entry_point       = "main"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.aggregator_source.name
      }
    }
  }

  service_config {
    max_instance_count    = 5
    min_instance_count    = 0
    available_memory      = "512Mi"
    timeout_seconds       = 540
    service_account_email = var.create_dev_service_accounts ? google_service_account.aggregator_dev[0].email : var.service_account_email

    environment_variables = {
      GCP_PROJECT_ID       = var.gcp_project_id
      GCP_BUCKET_NAME      = google_storage_bucket.aggregation_bucket.name
      GCP_AGG_SUBSCRIPTION = google_pubsub_subscription.aggregator.name
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
  }

  labels = local.common_labels
}

# API Gateway (Python Function - Source Package)
resource "google_cloudfunctions2_function" "api_gateway" {
  name        = "${var.project_name}_api_gateway_${var.environment}"
  location    = var.gcp_region
  description = "API gateway for serving activity data (${var.environment})"

  build_config {
    runtime           = "python313"
    entry_point       = "main"
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.api_gateway_source.name
      }
    }
  }

  service_config {
    max_instance_count             = 10
    min_instance_count             = 0
    available_memory               = "256Mi"
    timeout_seconds                = 60
    service_account_email          = var.create_dev_service_accounts ? google_service_account.aggregator_dev[0].email : var.service_account_email
    ingress_settings               = "ALLOW_ALL"
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
