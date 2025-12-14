# Outputs from the Desirelines module

# BigQuery outputs
output "bigquery_dataset_id" {
  description = "ID of the BigQuery dataset"
  value       = google_bigquery_dataset.activities_dataset.dataset_id
}

output "bigquery_table_id" {
  description = "ID of the activities BigQuery table"
  value       = google_bigquery_table.activities.table_id
}

output "bigquery_table_full_id" {
  description = "Full ID of the activities BigQuery table (project:dataset.table)"
  value       = "${var.gcp_project_id}:${google_bigquery_dataset.activities_dataset.dataset_id}.${google_bigquery_table.activities.table_id}"
}

# Storage outputs
output "storage_bucket_name" {
  description = "Name of the Cloud Storage bucket for aggregated data"
  value       = google_storage_bucket.aggregation_bucket.name
}

output "storage_bucket_url" {
  description = "URL of the Cloud Storage bucket"
  value       = google_storage_bucket.aggregation_bucket.url
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
    table_name   = google_bigquery_table.activities.table_id
    bucket_name  = google_storage_bucket.aggregation_bucket.name
    topic_name   = google_pubsub_topic.activity_events.name
  }
}

# Configuration values for applications
output "application_config" {
  description = "Configuration values needed by the applications"
  value = {
    gcp_project_id       = var.gcp_project_id
    gcp_bigquery_dataset = google_bigquery_dataset.activities_dataset.dataset_id
    gcp_bucket_name      = google_storage_bucket.aggregation_bucket.name
    gcp_pubsub_topic     = google_pubsub_topic.activity_events.name
  }
}

# Development service account outputs (only when created)
output "dev_service_accounts" {
  description = "Development service account emails for Docker Compose"
  value = var.create_dedicated_service_accounts ? {
    dispatcher_email  = google_service_account.dispatcher_dev[0].email
    aggregator_email  = google_service_account.aggregator_dev[0].email
    bq_inserter_email = google_service_account.bq_inserter_dev[0].email
  } : {}
}

# Cloud Run Service URLs (Go services + Python FastAPI services)
output "cloud_run_urls" {
  description = "Cloud Run service URLs (stable, do not change on redeploy)"
  value = var.deployment_mode == "full" ? {
    dispatcher_url      = google_cloud_run_v2_service.dispatcher[0].uri
    api_gateway_url     = google_cloud_run_v2_service.api_gateway[0].uri
    bq_inserter_url     = google_cloud_run_v2_service.bq_inserter[0].uri
    postgres_writer_url = google_cloud_run_v2_service.postgres_writer[0].uri
  } : {}
}

# Cloud Function outputs (only available in "full" deployment mode)
# Only aggregator still uses Cloud Functions v2 (bq_inserter and postgres_writer migrated to Cloud Run)
output "cloud_function_urls" {
  description = "URLs for Python Cloud Functions (ephemeral - may change on redeploy)"
  value = var.deployment_mode == "full" ? {
    aggregator_url = google_cloudfunctions2_function.activity_aggregator[0].service_config[0].uri
  } : {}
}

output "service_names" {
  description = "Names of deployed services (Cloud Run + Cloud Functions)"
  value = var.deployment_mode == "full" ? {
    # Cloud Run services
    dispatcher      = google_cloud_run_v2_service.dispatcher[0].name
    api_gateway     = google_cloud_run_v2_service.api_gateway[0].name
    bq_inserter     = google_cloud_run_v2_service.bq_inserter[0].name
    postgres_writer = google_cloud_run_v2_service.postgres_writer[0].name
    # Cloud Functions (only aggregator)
    aggregator = google_cloudfunctions2_function.activity_aggregator[0].name
  } : {}
}

# Artifact Registry outputs
output "artifact_registry_repository" {
  description = "Artifact Registry repository for container images (shared across environments)"
  value       = google_artifact_registry_repository.functions.name
}

output "container_image_base_url" {
  description = "Base URL for container images in Artifact Registry"
  value       = "${var.artifact_registry_location}-docker.pkg.dev/${var.gcp_project_id}/${var.project_name}-functions"
}

# Deployment information
output "deployment_info" {
  description = "Information needed for CI/CD deployment"
  value = {
    artifact_registry_repo = google_artifact_registry_repository.functions.name
    image_base_url         = "${var.artifact_registry_location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.functions.repository_id}"
    deployment_version     = var.deployment_version
  }
}

# Deployed version tag (for code provenance and observability)
output "deployed_version" {
  description = "Version tag for all deployed code (Cloud Run images and Cloud Function source packages)"
  value       = var.deployment_version
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
