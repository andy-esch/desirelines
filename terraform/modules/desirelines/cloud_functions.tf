# ==============================================================================
# Cloud Functions Infrastructure
# ==============================================================================
# This file contains all Cloud Function resources and their supporting storage.
# - Function source buckets and objects
# - Aggregation output bucket
# - Cloud Functions (aggregator)

# Locals for function source configuration
locals {
  # Function source bucket (local or external)
  function_source_bucket = var.external_function_source_bucket != null ? var.external_function_source_bucket : google_storage_bucket.function_source[0].name

  # Function source object names (Python Cloud Functions only - Go services use Docker images)
  # NOTE: bq-inserter and postgres-writer now use Cloud Run services (see cloud_run.tf)
  # bq_inserter_object_name     = "bq-inserter-${var.deployment_version}.zip"
  aggregator_object_name = "aggregator-${var.deployment_version}.zip"
  # postgres_writer_object_name = "postgres-writer-${var.deployment_version}.zip"
}

# ==============================================================================
# Storage Buckets
# ==============================================================================

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

  # Version cleanup: Keep last 10 versions OR 7 days, whichever comes first
  # Rationale: BigQuery is source of truth, aggregations can be regenerated
  # This prevents version accumulation while allowing recent rollback for debugging
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 7  # Delete versions older than 7 days
      num_newer_versions         = 10 # OR keep max 10 versions per object
    }
    action {
      type = "Delete"
    }
  }
}

# ==============================================================================
# Function Source Storage Objects (Python Cloud Functions only)
# ==============================================================================
# Note: dispatcher, api-gateway, bq-inserter, and postgres-writer are now deployed
# as Cloud Run services using Docker images from Artifact Registry.
# Only aggregator still uses Cloud Functions source packages.

# Upload function source packages to Cloud Storage (only when using local bucket)
# Packages are built by Pants: pants package functions:aggregator

# DEPRECATED: bq-inserter now uses Cloud Run (see cloud_run.tf and eventarc.tf)
# resource "google_storage_bucket_object" "bq_inserter_source" {
#   count = var.external_function_source_bucket == null ? 1 : 0
#
#   name   = "bq-inserter-${var.deployment_version}.zip"
#   bucket = google_storage_bucket.function_source[0].name
#   source = "${path.module}/../../../dist/functions/bq-inserter.zip"
# }

resource "google_storage_bucket_object" "aggregator_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name   = "aggregator-${var.deployment_version}.zip"
  bucket = google_storage_bucket.function_source[0].name
  source = "${path.module}/../../../dist/functions/aggregator.zip"
}

# DEPRECATED: postgres-writer now uses Cloud Run (see cloud_run.tf and eventarc.tf)
# resource "google_storage_bucket_object" "postgres_writer_source" {
#   count = var.external_function_source_bucket == null ? 1 : 0
#
#   name   = "postgres-writer-${var.deployment_version}.zip"
#   bucket = google_storage_bucket.function_source[0].name
#   source = "${path.module}/../../../dist/functions/postgres-writer.zip"
# }

# ==============================================================================
# CLOUD FUNCTIONS (Only created in "full" deployment mode)
# ==============================================================================

# DEPRECATED: BQ Inserter now uses Cloud Run (see cloud_run.tf and eventarc.tf)
# Keeping commented out for reference during migration period.
#
# # Activity BQ Inserter (Python Function - Source Package)
# resource "google_cloudfunctions2_function" "activity_bq_inserter" {
#   count       = var.deployment_mode == "full" ? 1 : 0
#   name        = "${var.project_name}_bq_inserter"
#   location    = var.gcp_region
#   description = "Activity BigQuery inserter (${var.environment})"
#
#   build_config {
#     runtime           = "python312"
#     entry_point       = "handler"
#     docker_repository = google_artifact_registry_repository.functions.id
#
#     source {
#       storage_source {
#         bucket = local.function_source_bucket
#         object = local.bq_inserter_object_name
#       }
#     }
#   }
#
#   service_config {
#     max_instance_count    = 1
#     min_instance_count    = 0
#     available_memory      = "256Mi"
#     timeout_seconds       = 540
#     service_account_email = var.create_dedicated_service_accounts ? google_service_account.bq_inserter_dev[0].email : var.service_account_email
#     ingress_settings      = "ALLOW_INTERNAL_ONLY"
#
#     environment_variables = {
#       GCP_PROJECT_ID       = var.gcp_project_id
#       GCP_BIGQUERY_DATASET = google_bigquery_dataset.activities_dataset.dataset_id
#       GCP_BIGQUERY_TABLE   = google_bigquery_table.activities.table_id
#       ENVIRONMENT          = var.environment
#       LOG_LEVEL            = "INFO"
#     }
#
#     # Mount Strava secrets as volume
#     secret_volumes {
#       mount_path = "/etc/secrets"
#       project_id = var.gcp_project_id
#       secret     = "strava-auth-${var.environment}"
#       versions {
#         version = "latest"
#         path    = "strava_auth.json"
#       }
#     }
#   }
#
#   event_trigger {
#     trigger_region = var.gcp_region
#     event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
#     pubsub_topic   = google_pubsub_topic.activity_events.id
#     retry_policy   = "RETRY_POLICY_RETRY"
#   }
#
#   labels = local.common_labels
# }

# Activity Aggregator (Python Function - Source Package)
resource "google_cloudfunctions2_function" "activity_aggregator" {
  count       = var.deployment_mode == "full" ? 1 : 0
  name        = "${var.project_name}_aggregator"
  location    = var.gcp_region
  description = "Activity aggregator and storage writer (${var.environment})"

  build_config {
    runtime           = "python312"
    entry_point       = "handler"
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
    service_account_email = var.create_dedicated_service_accounts ? google_service_account.aggregator_dev[0].email : var.service_account_email
    ingress_settings      = "ALLOW_INTERNAL_ONLY"


    environment_variables = {
      GCP_PROJECT_ID       = var.gcp_project_id
      GCP_BUCKET_NAME      = google_storage_bucket.aggregation_bucket.name
      ENVIRONMENT          = var.environment
      LOG_LEVEL            = "INFO"
      FORCE_REDEPLOY       = "2025-09-19-new-strava-scope-v1"
      ENABLE_CLOUD_LOGGING = "true"

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

# DEPRECATED: PostgreSQL Writer now uses Cloud Run (see cloud_run.tf and eventarc.tf)
# Keeping commented out for reference during migration period.
#
# # PostgreSQL Writer (Python Function - Source Package)
# resource "google_cloudfunctions2_function" "postgres_writer" {
#   count       = var.deployment_mode == "full" ? 1 : 0
#   name        = "${var.project_name}_postgres_writer"
#   location    = var.gcp_region
#   description = "Syncs Strava activities to PostgreSQL (${var.environment})"
#
#   build_config {
#     runtime           = "python312"
#     entry_point       = "handler"
#     docker_repository = google_artifact_registry_repository.functions.id
#
#     source {
#       storage_source {
#         bucket = local.function_source_bucket
#         object = local.postgres_writer_object_name
#       }
#     }
#   }
#
#   service_config {
#     max_instance_count    = 1
#     min_instance_count    = 0
#     available_memory      = "256Mi"
#     timeout_seconds       = 60
#     service_account_email = var.create_dedicated_service_accounts ? google_service_account.postgres_writer_dev[0].email : var.service_account_email
#     ingress_settings      = "ALLOW_INTERNAL_ONLY"
#
#     environment_variables = {
#       GCP_PROJECT_ID = var.gcp_project_id
#       ENVIRONMENT    = var.environment
#       LOG_LEVEL      = "INFO"
#     }
#
#     # Mount Strava secrets as volume
#     secret_volumes {
#       mount_path = "/etc/secrets"
#       project_id = var.gcp_project_id
#       secret     = "strava-auth-${var.environment}"
#       versions {
#         version = "latest"
#         path    = "strava_auth.json"
#       }
#     }
#
#     # Mount PostgreSQL connection string as volume
#     secret_volumes {
#       mount_path = "/etc/secrets/postgres"
#       project_id = var.gcp_project_id
#       secret     = "postgres-connection-string-${var.environment}"
#       versions {
#         version = "latest"
#         path    = "connection_string"
#       }
#     }
#   }
#
#   event_trigger {
#     trigger_region = var.gcp_region
#     event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
#     pubsub_topic   = google_pubsub_topic.activity_events.id
#     retry_policy   = "RETRY_POLICY_RETRY"
#   }
#
#   depends_on = [
#     google_secret_manager_secret_iam_member.postgres_writer_strava_auth_access,
#     google_secret_manager_secret_iam_member.postgres_writer_postgres_access,
#     google_storage_bucket_object.postgres_writer_source
#   ]
#
#   labels = local.common_labels
# }
