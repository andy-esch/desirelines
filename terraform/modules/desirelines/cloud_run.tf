# Cloud Run Services (Go services deployed as Docker images)
# These replace the previous Cloud Functions v2 deployments for dispatcher and apigateway

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
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.functions.repository_id}/dispatcher:${var.deployment_version}"

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
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.functions.repository_id}/apigateway:${var.deployment_version}"

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

      # Mount PostgreSQL secrets as volume
      volume_mounts {
        name       = "postgres-secrets"
        mount_path = "/etc/secrets/postgres"
      }
    }

    volumes {
      name = "postgres-secrets"
      secret {
        secret       = "postgres-connection-string-${var.environment}"
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
