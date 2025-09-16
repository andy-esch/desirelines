# Outputs for local environment

output "application_config" {
  description = "Configuration values for local development"
  value       = module.desirelines.application_config
}

output "resource_names" {
  description = "All resource names for local environment"
  value       = module.desirelines.resource_names
}

# Specific outputs that match current application expectations
output "bigquery_dataset_id" {
  description = "BigQuery dataset ID for local environment"
  value       = module.desirelines.bigquery_dataset_id
}

output "storage_bucket_name" {
  description = "Storage bucket name for local environment"
  value       = module.desirelines.storage_bucket_name
}

output "pubsub_topic_name" {
  description = "PubSub topic name for local environment"
  value       = module.desirelines.pubsub_topic_name
}

# Development service account outputs
output "dev_service_accounts" {
  description = "Development service account emails for Docker Compose"
  value       = module.desirelines.dev_service_accounts
}
