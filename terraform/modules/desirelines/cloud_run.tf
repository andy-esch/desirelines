# Cloud Run Services (Go services deployed as Docker images)
# These replace the previous Cloud Functions v2 deployments for dispatcher and apigateway

# Compute image base URL - use external registry if provided (cross-project sharing)
locals {
  image_base_url = var.external_artifact_registry != null ? var.external_artifact_registry : "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.functions.repository_id}"
}

# ==============================================================================
# Dispatcher - Cloud Run Service
# ==============================================================================

resource "google_cloud_run_v2_service" "dispatcher" {
  count    = var.deployment_mode == "full" ? 1 : 0
  name     = "${var.project_name}-dispatcher"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL" # Required for Strava webhooks

  labels = local.common_labels

  template {
    service_account = var.create_dedicated_service_accounts ? google_service_account.dispatcher_dev[0].email : var.service_account_email

    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }

    containers {
      image = "${local.image_base_url}/dispatcher:${var.deployment_version}"

      resources {
        limits = {
          cpu    = "0.25" # 1/4 vCPU - minimal for cost savings
          memory = "128Mi"
        }
        cpu_idle          = true  # Scale to zero when idle
        startup_cpu_boost = false # Disable CPU boost for cost savings
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }

      env {
        name  = "GCP_PUBSUB_TOPIC"
        value = google_pubsub_topic.activity_events.name
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }

      env {
        name  = "LOG_LEVEL"
        value = "INFO"
      }

      # Mount Strava secrets as volume
      volume_mounts {
        name       = "strava-secrets"
        mount_path = "/etc/secrets"
      }
    }

    volumes {
      name = "strava-secrets"
      secret {
        secret       = "strava-auth-${var.environment}"
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "strava_auth.json"
          mode    = 292 # 0444
        }
      }
    }

    timeout = "60s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Allow unauthenticated access to dispatcher (required for Strava webhooks)
resource "google_cloud_run_v2_service_iam_member" "dispatcher_public_access" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.dispatcher[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ==============================================================================
# API Gateway - Cloud Run Service
# ==============================================================================

resource "google_cloud_run_v2_service" "api_gateway" {
  count    = var.deployment_mode == "full" ? 1 : 0
  name     = "${var.project_name}-api-gateway"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL" # Public web access

  labels = local.common_labels

  template {
    service_account = var.create_dedicated_service_accounts ? google_service_account.api_gateway_dev[0].email : var.service_account_email

    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }

    containers {
      image = "${local.image_base_url}/apigateway:${var.deployment_version}"

      resources {
        limits = {
          cpu    = "0.25" # 1/4 vCPU - minimal for cost savings
          memory = "128Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = false # Disable CPU boost for cost savings
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }

      env {
        name  = "GCP_BUCKET_NAME"
        value = google_storage_bucket.aggregation_bucket.name
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.api_gateway_allowed_origins
      }

      env {
        name  = "ALLOWED_EMAILS"
        value = var.developer_email != null ? var.developer_email : ""
      }

      env {
        name  = "DATA_SOURCE"
        value = "cloud-storage"
      }

      # Mount PostgreSQL secrets as volume (read-only apigateway role)
      volume_mounts {
        name       = "postgres-secrets"
        mount_path = "/etc/secrets/postgres"
      }
    }

    volumes {
      name = "postgres-secrets"
      secret {
        secret       = "postgres-conn-apigateway-${var.environment}"
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "connection_string"
          mode    = 292 # 0444
        }
      }
    }

    timeout = "60s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_secret_manager_secret_iam_member.api_gateway_postgres_access
  ]
}

# Allow unauthenticated access to API Gateway (required for web app access)
resource "google_cloud_run_v2_service_iam_member" "api_gateway_public_access" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.api_gateway[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ==============================================================================
# BQ Inserter - Cloud Run Service (Python/FastAPI)
# ==============================================================================
# Replaces the Cloud Functions v2 deployment for bq_inserter
# Uses FastAPI + Uvicorn for better performance and CloudEvent support

resource "google_cloud_run_v2_service" "bq_inserter" {
  count    = var.deployment_mode == "full" ? 1 : 0
  name     = "${var.project_name}-bq-inserter"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY" # Only Eventarc can call this

  labels = local.common_labels

  template {
    service_account = var.create_dedicated_service_accounts ? google_service_account.bq_inserter_dev[0].email : var.service_account_email

    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }

    containers {
      image = "${local.image_base_url}/bq-inserter:${var.deployment_version}"

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }

      env {
        name  = "GCP_BIGQUERY_DATASET"
        value = google_bigquery_dataset.activities_dataset.dataset_id
      }

      env {
        name  = "GCP_BIGQUERY_TABLE"
        value = google_bigquery_table.activities.table_id
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }

      env {
        name  = "LOG_LEVEL"
        value = "INFO"
      }

      env {
        name  = "ENABLE_CLOUD_LOGGING"
        value = "true"
      }

      # Mount Strava secrets as volume
      volume_mounts {
        name       = "strava-secrets"
        mount_path = "/etc/secrets"
      }
    }

    volumes {
      name = "strava-secrets"
      secret {
        secret       = "strava-auth-${var.environment}"
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "strava_auth.json"
          mode    = 292 # 0444
        }
      }
    }

    timeout = "540s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# ==============================================================================
# PostgreSQL Writer - Cloud Run Service (Python/FastAPI)
# ==============================================================================
# Replaces the Cloud Functions v2 deployment for postgres_writer
# Uses FastAPI + Uvicorn for better performance and CloudEvent support

resource "google_cloud_run_v2_service" "postgres_writer" {
  count    = var.deployment_mode == "full" ? 1 : 0
  name     = "${var.project_name}-postgres-writer"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY" # Only Eventarc can call this

  labels = local.common_labels

  template {
    service_account = var.create_dedicated_service_accounts ? google_service_account.postgres_writer_dev[0].email : var.service_account_email

    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }

    containers {
      image = "${local.image_base_url}/postgres-writer:${var.deployment_version}"

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }

      env {
        name  = "LOG_LEVEL"
        value = "INFO"
      }

      env {
        name  = "ENABLE_CLOUD_LOGGING"
        value = "true"
      }

      # Mount Strava secrets as volume
      volume_mounts {
        name       = "strava-secrets"
        mount_path = "/etc/secrets"
      }

      # Mount PostgreSQL secrets as volume (read/write writer role)
      volume_mounts {
        name       = "postgres-secrets"
        mount_path = "/etc/secrets/postgres"
      }
    }

    volumes {
      name = "strava-secrets"
      secret {
        secret       = "strava-auth-${var.environment}"
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "strava_auth.json"
          mode    = 292 # 0444
        }
      }
    }

    volumes {
      name = "postgres-secrets"
      secret {
        secret       = "postgres-conn-writer-${var.environment}"
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "connection_string"
          mode    = 292 # 0444
        }
      }
    }

    timeout = "60s"
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_secret_manager_secret_iam_member.postgres_writer_strava_auth_access,
    google_secret_manager_secret_iam_member.postgres_writer_postgres_access,
  ]
}

# ==============================================================================
# IAM Bindings for Eventarc → Cloud Run Invocation
# ==============================================================================
# Eventarc triggers use service accounts that need permission to invoke
# the Cloud Run services. These are internal-only services, so we grant
# run.invoker to the specific service accounts (not allUsers).

# Allow BQ Inserter's service account to be invoked by Eventarc
resource "google_cloud_run_v2_service_iam_member" "bq_inserter_eventarc_invoker" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.bq_inserter[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.create_dedicated_service_accounts ? google_service_account.bq_inserter_dev[0].email : var.service_account_email}"
}

# Allow PostgreSQL Writer's service account to be invoked by Eventarc
resource "google_cloud_run_v2_service_iam_member" "postgres_writer_eventarc_invoker" {
  count    = var.deployment_mode == "full" ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.postgres_writer[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.create_dedicated_service_accounts ? google_service_account.postgres_writer_dev[0].email : var.service_account_email}"
}
