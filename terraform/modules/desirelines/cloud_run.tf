# Cloud Run Services (Go services deployed as Docker images)
# These replace the previous Cloud Functions v2 deployments for dispatcher and apigateway

# Image base URL from shared artifacts project
locals {
  image_base_url = var.external_artifact_registry

  # Secrets for API Gateway OAuth flow
  api_gateway_oauth_secrets = {
    "INFISICAL_STRAVA_CLIENT_ID"     = google_secret_manager_secret.strava_client_id.secret_id
    "INFISICAL_STRAVA_CLIENT_SECRET" = google_secret_manager_secret.strava_client_secret.secret_id
    "INFISICAL_AUTH_STATE_SECRET"    = google_secret_manager_secret.auth_state_secret.secret_id
  }

  # Secret definitions for dynamic blocks
  # Keys use INFISICAL_ prefix to match Infisical-managed secret names
  strava_webhook_secrets = {
    "INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN"    = google_secret_manager_secret.strava_webhook_verify_token.secret_id
    "INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID" = google_secret_manager_secret.strava_webhook_subscription_id.secret_id
  }

  strava_api_secrets = {
    "INFISICAL_STRAVA_CLIENT_ID"     = google_secret_manager_secret.strava_client_id.secret_id
    "INFISICAL_STRAVA_CLIENT_SECRET" = google_secret_manager_secret.strava_client_secret.secret_id
  }

  # Combined secrets for dispatcher service
  dispatcher_secrets = merge(local.strava_webhook_secrets, local.strava_api_secrets)
}

# ==============================================================================
# Dispatcher - Cloud Run Service
# ==============================================================================

resource "google_cloud_run_v2_service" "dispatcher" {
  name     = "${var.project_name}-dispatcher"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL" # Required for Strava webhooks

  labels = local.common_labels

  template {
    service_account = google_service_account.dispatcher.email

    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }

    max_instance_request_concurrency = 1 # Serialize webhook processing to avoid token refresh races

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
        value = var.app_config.log_level
      }

      env {
        name  = "FIRESTORE_DATABASE"
        value = google_firestore_database.user_configs.name
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        failure_threshold     = 3
      }

      # Mount Strava Webhook secrets as atomic volumes
      dynamic "volume_mounts" {
        for_each = local.dispatcher_secrets
        content {
          name       = lower(replace(volume_mounts.key, "_", "-"))
          mount_path = "/etc/secrets/${volume_mounts.key}"
        }
      }
    }

    dynamic "volumes" {
      for_each = local.dispatcher_secrets
      content {
        name = lower(replace(volumes.key, "_", "-"))
        secret {
          secret       = volumes.value
          default_mode = 292 # 0444
          items {
            version = "latest"
            path    = "value"
            mode    = 292
          }
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
    google_secret_manager_secret_iam_member.dispatcher_webhook_tokens,
    google_secret_manager_secret_iam_member.dispatcher_api_tokens,
    google_project_iam_member.dispatcher_firestore
  ]
}

# Allow unauthenticated access to dispatcher (required for Strava webhooks)
resource "google_cloud_run_v2_service_iam_member" "dispatcher_public_access" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.dispatcher.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ==============================================================================
# API Gateway - Cloud Run Service
# ==============================================================================

resource "google_cloud_run_v2_service" "api_gateway" {
  name     = "${var.project_name}-api-gateway"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL" # Public web access

  labels = local.common_labels

  template {
    service_account = google_service_account.api_gateway.email

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
        name  = "ENVIRONMENT"
        value = var.environment
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.api_gateway_allowed_origins
      }

      env {
        name  = "FRONTEND_URL"
        value = var.app_config.frontend_url
      }

      env {
        name  = "AUTH_CALLBACK_URL"
        value = var.app_config.auth_callback_url
      }

      env {
        name  = "FIRESTORE_DATABASE"
        value = google_firestore_database.user_configs.name
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        failure_threshold     = 3
      }

      # Mount allowed emails as secret volume (PII - not exposed as env var)
      volume_mounts {
        name       = "infisical-allowed-emails"
        mount_path = "/etc/secrets/INFISICAL_ALLOWED_EMAILS"
      }

      # Mount PostgreSQL secrets as volume (read-only apigateway role)
      volume_mounts {
        name       = "infisical-postgres-conn-apigateway"
        mount_path = "/etc/secrets/INFISICAL_POSTGRES_CONN_APIGATEWAY"
      }

      # Mount Strava OAuth secrets as atomic volumes
      dynamic "volume_mounts" {
        for_each = local.api_gateway_oauth_secrets
        content {
          name       = lower(replace(volume_mounts.key, "_", "-"))
          mount_path = "/etc/secrets/${volume_mounts.key}"
        }
      }
    }

    volumes {
      name = "infisical-allowed-emails"
      secret {
        secret       = google_secret_manager_secret.allowed_emails.secret_id
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "value"
          mode    = 292 # 0444
        }
      }
    }

    volumes {
      name = "infisical-postgres-conn-apigateway"
      secret {
        secret       = google_secret_manager_secret.postgres_conn_apigateway.secret_id
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "value"
          mode    = 292 # 0444
        }
      }
    }

    dynamic "volumes" {
      for_each = local.api_gateway_oauth_secrets
      content {
        name = lower(replace(volumes.key, "_", "-"))
        secret {
          secret       = volumes.value
          default_mode = 292 # 0444
          items {
            version = "latest"
            path    = "value"
            mode    = 292
          }
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
    google_secret_manager_secret_iam_member.api_gateway_allowed_emails_access,
    google_secret_manager_secret_iam_member.api_gateway_postgres_access,
    google_secret_manager_secret_iam_member.api_gateway_strava_oauth_secrets,
    google_service_account_iam_member.api_gateway_token_creator,
    google_project_iam_member.api_gateway_firestore
  ]
}

# Allow unauthenticated access to API Gateway (required for web app access)
resource "google_cloud_run_v2_service_iam_member" "api_gateway_public_access" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.api_gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ==============================================================================
# BQ Inserter - Cloud Run Service (Python/FastAPI)
# ==============================================================================
# Replaces the Cloud Functions v2 deployment for bq_inserter
# Uses FastAPI + Uvicorn for better performance and CloudEvent support

resource "google_cloud_run_v2_service" "bq_inserter" {
  name     = "${var.project_name}-bq-inserter"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY" # Only Eventarc can call this

  labels = local.common_labels

  template {
    service_account = google_service_account.bq_inserter.email

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
        value = var.app_config.log_level
      }

      env {
        name  = "ENABLE_CLOUD_LOGGING"
        value = "true"
      }

      env {
        name  = "ENABLE_OTEL_METRICS"
        value = "true"
      }

      # Python/Uvicorn needs more startup time than Go services:
      # FastAPI lifespan must complete before /health is served
      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }
    }

    timeout = "60s"
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
  name     = "${var.project_name}-postgres-writer"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY" # Only Eventarc can call this

  labels = local.common_labels

  template {
    service_account = google_service_account.postgres_writer.email

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
        value = var.app_config.log_level
      }

      env {
        name  = "ENABLE_CLOUD_LOGGING"
        value = "true"
      }

      env {
        name  = "ENABLE_OTEL_METRICS"
        value = "true"
      }

      # Python/Uvicorn needs more startup time than Go services:
      # FastAPI lifespan must complete (incl. DB connection) before /health is served
      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }

      # Mount PostgreSQL secrets as volume (read/write writer role)
      volume_mounts {
        name       = "infisical-postgres-conn-writer"
        mount_path = "/etc/secrets/INFISICAL_POSTGRES_CONN_WRITER"
      }
    }

    volumes {
      name = "infisical-postgres-conn-writer"
      secret {
        secret       = google_secret_manager_secret.postgres_conn_writer.secret_id
        default_mode = 292 # 0444 in octal (read-only)
        items {
          version = "latest"
          path    = "value"
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
    google_secret_manager_secret_iam_member.postgres_writer_postgres_access,
  ]
}

# ==============================================================================
# Backfill - Cloud Run Job (Python batch job)
# ==============================================================================
# Runs to completion (not a web server). Triggered manually via:
#   gcloud run jobs execute desirelines-backfill --set-env-vars ATHLETE_ID=...

resource "google_cloud_run_v2_job" "backfill" {
  name     = "${var.project_name}-backfill"
  location = var.gcp_region

  labels = local.common_labels

  template {
    template {
      service_account = google_service_account.backfill.email

      max_retries = 0 # Batch job — don't retry on failure

      timeout = "3600s" # 1 hour max for large backfills

      containers {
        image = "${local.image_base_url}/backfill:${var.deployment_version}"

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "GCP_PROJECT_ID"
          value = var.gcp_project_id
        }

        env {
          name  = "FIRESTORE_DATABASE"
          value = google_firestore_database.user_configs.name
        }

        env {
          name  = "GCP_BIGQUERY_DATASET"
          value = google_bigquery_dataset.activities_dataset.dataset_id
        }

        env {
          name  = "LOG_LEVEL"
          value = var.app_config.log_level
        }

        # ATHLETE_ID and BACKFILL_YEARS are set at execution time via:
        #   gcloud run jobs execute ... --set-env-vars ATHLETE_ID=12345,BACKFILL_YEARS=2024,2025

        # Mount PostgreSQL writer secret
        volume_mounts {
          name       = "infisical-postgres-conn-writer"
          mount_path = "/etc/secrets/INFISICAL_POSTGRES_CONN_WRITER"
        }

        # Mount Strava API secrets
        dynamic "volume_mounts" {
          for_each = local.strava_api_secrets
          content {
            name       = lower(replace(volume_mounts.key, "_", "-"))
            mount_path = "/etc/secrets/${volume_mounts.key}"
          }
        }
      }

      volumes {
        name = "infisical-postgres-conn-writer"
        secret {
          secret       = google_secret_manager_secret.postgres_conn_writer.secret_id
          default_mode = 292 # 0444
          items {
            version = "latest"
            path    = "value"
            mode    = 292
          }
        }
      }

      dynamic "volumes" {
        for_each = local.strava_api_secrets
        content {
          name = lower(replace(volumes.key, "_", "-"))
          secret {
            secret       = volumes.value
            default_mode = 292 # 0444
            items {
              version = "latest"
              path    = "value"
              mode    = 292
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.backfill_postgres_access,
    google_secret_manager_secret_iam_member.backfill_strava_api_secrets,
    google_project_iam_member.backfill_firestore,
  ]
}

# ==============================================================================
# IAM Bindings for Pub/Sub Push → Cloud Run Invocation
# ==============================================================================
# Push subscriptions use OIDC tokens signed by service accounts to authenticate.
# These service accounts need permission to invoke their respective Cloud Run services.
# These are internal-only services, so we grant run.invoker to the specific
# service accounts (not allUsers).

# Allow BQ Inserter's service account to invoke the Cloud Run service
# (used by Pub/Sub push subscription OIDC authentication)
resource "google_cloud_run_v2_service_iam_member" "bq_inserter_eventarc_invoker" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.bq_inserter.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.bq_inserter.email}"
}

# Allow PostgreSQL Writer's service account to invoke the Cloud Run service
# (used by Pub/Sub push subscription OIDC authentication)
resource "google_cloud_run_v2_service_iam_member" "postgres_writer_eventarc_invoker" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.postgres_writer.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.postgres_writer.email}"
}
