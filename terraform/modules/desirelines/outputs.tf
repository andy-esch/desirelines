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
  value = var.create_dev_service_accounts ? {
    dispatcher_email  = google_service_account.dispatcher_dev[0].email
    aggregator_email  = google_service_account.aggregator_dev[0].email
    bq_inserter_email = google_service_account.bq_inserter_dev[0].email
  } : {}
}

# Cloud Function outputs (only available in "full" deployment mode)
output "cloud_function_urls" {
  description = "URLs for Cloud Functions"
  value = var.deployment_mode == "full" ? {
    dispatcher_url  = google_cloudfunctions2_function.activity_dispatcher[0].service_config[0].uri
    api_gateway_url = google_cloudfunctions2_function.api_gateway[0].service_config[0].uri
  } : {}
}

output "cloud_function_names" {
  description = "Names of deployed Cloud Functions"
  value = var.deployment_mode == "full" ? {
    dispatcher  = google_cloudfunctions2_function.activity_dispatcher[0].name
    bq_inserter = google_cloudfunctions2_function.activity_bq_inserter[0].name
    aggregator  = google_cloudfunctions2_function.activity_aggregator[0].name
    api_gateway = google_cloudfunctions2_function.api_gateway[0].name
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
    image_base_url         = "${var.artifact_registry_location}-docker.pkg.dev/${var.gcp_project_id}/${var.project_name}-functions"
    current_image_tag      = var.function_image_tag
  }
}

# Deployed function source SHA (for observability)
output "deployed_function_source_tag" {
  description = "SHA tag of deployed function sources"
  value       = var.function_source_tag
}
