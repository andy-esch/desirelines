# Outputs from the Desirelines module

# BigQuery outputs
output "bigquery_dataset_id" {
  description = "ID of the BigQuery dataset"
  value       = google_bigquery_dataset.activities_dataset.dataset_id
}

# Firestore outputs
output "firestore_database_name" {
  description = "Name of the Firestore database"
  value       = google_firestore_database.user_configs.name
}

output "firestore_database_location" {
  description = "Location of the Firestore database"
  value       = google_firestore_database.user_configs.location_id
}

# PubSub outputs
output "pubsub_topic_name" {
  description = "Name of the main PubSub topic for activity events"
  value       = google_pubsub_topic.activity_events.name
}


output "pubsub_dead_letter_topic_name" {
  description = "Name of the dead letter PubSub topic"
  value       = google_pubsub_topic.dead_letter.name
}

# Resource naming outputs (useful for application configuration)
output "resource_names" {
  description = "Map of all resource names for easy reference"
  value = {
    dataset_name = google_bigquery_dataset.activities_dataset.dataset_id
    table_name   = google_bigquery_table.activities_live.table_id
    topic_name   = google_pubsub_topic.activity_events.name
  }
}

# Configuration values for applications
output "application_config" {
  description = "Configuration values needed by the applications"
  value = {
    gcp_project_id       = var.gcp_project_id
    gcp_bigquery_dataset = google_bigquery_dataset.activities_dataset.dataset_id
    gcp_pubsub_topic     = google_pubsub_topic.activity_events.name
  }
}

# Service account outputs
output "service_accounts" {
  description = "Service account emails for each service"
  value = {
    dispatcher_email      = google_service_account.dispatcher.email
    api_gateway_email     = google_service_account.api_gateway.email
    postgres_writer_email = google_service_account.postgres_writer.email
  }
}

# Cloud Run Service URLs (Go services + Python FastAPI services)
output "cloud_run_urls" {
  description = "Cloud Run service URLs (stable, do not change on redeploy)"
  value = {
    dispatcher_url      = google_cloud_run_v2_service.dispatcher.uri
    api_gateway_url     = google_cloud_run_v2_service.api_gateway.uri
    postgres_writer_url = google_cloud_run_v2_service.postgres_writer.uri
  }
}

output "service_names" {
  description = "Names of deployed services and jobs (Cloud Run)"
  value = {
    dispatcher      = google_cloud_run_v2_service.dispatcher.name
    api_gateway     = google_cloud_run_v2_service.api_gateway.name
    postgres_writer = google_cloud_run_v2_service.postgres_writer.name
    backfill        = google_cloud_run_v2_job.backfill.name
  }
}

# Deployment information
output "deployment_info" {
  description = "Deployment provenance: image registry, version tag, and the exact image reference deployed per service"
  value = {
    image_base_url     = var.external_artifact_registry
    deployment_version = var.deployment_version

    # The exact reference each service is running. Digest form in steady state; a
    # tag here means that environment's tfvars carries no digest for the service,
    # which is expected only on a bootstrap apply.
    images = local.image_ref
  }
}

# Pub/Sub subscription names (useful for CLI commands and debugging)
output "pubsub_subscription_names" {
  description = "Names of Pub/Sub subscriptions for event processing"
  value = {
    postgres_writer      = google_pubsub_subscription.postgres_writer.name
    deletion_service     = google_pubsub_subscription.deletion_service.name
    postgres_writer_dlq  = google_pubsub_subscription.postgres_writer_dlq.name
    deletion_service_dlq = google_pubsub_subscription.deletion_service_dlq.name
  }
}

# Firebase Hosting outputs
output "firebase_hosting_site_id" {
  description = "Firebase Hosting site ID for web application"
  value       = google_firebase_hosting_site.web_app.site_id
}

output "firebase_hosting_url" {
  description = "Default Firebase Hosting URL for web application"
  value       = "https://${google_firebase_hosting_site.web_app.site_id}.web.app"
}

output "firebase_custom_domain" {
  description = "Custom domain for Firebase Hosting (production only)"
  value       = var.environment == "prod" ? google_firebase_hosting_custom_domain.app_subdomain[0].custom_domain : null
}

# Firebase Web App outputs (for .env configuration)
# Marked sensitive to prevent API key from appearing in CI/CD logs
# Note: Firebase API keys are designed to be public (they're in client JS),
# but we hide them from logs as a defense-in-depth measure
output "firebase_web_app_config" {
  description = "Firebase Web App configuration for frontend .env files"
  sensitive   = true
  value = {
    api_key             = data.google_firebase_web_app_config.web_app.api_key
    auth_domain         = "${var.gcp_project_id}.firebaseapp.com"
    project_id          = var.gcp_project_id
    storage_bucket      = data.google_firebase_web_app_config.web_app.storage_bucket
    messaging_sender_id = data.google_firebase_web_app_config.web_app.messaging_sender_id
    app_id              = google_firebase_web_app.web_app.app_id
    measurement_id      = lookup(data.google_firebase_web_app_config.web_app, "measurement_id", null)
  }
}

output "activity_rows_topic" {
  description = "Pub/Sub topic carrying activity ROW messages for the BigQuery CDC subscription"
  value       = google_pubsub_topic.activity_rows.name
}
