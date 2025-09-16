# Outputs for live (production) environment

output "application_config" {
  description = "Configuration values for production"
  value       = module.desirelines.application_config
}

output "resource_names" {
  description = "All resource names for production environment"
  value       = module.desirelines.resource_names
}

# Specific outputs that match current application expectations
output "bigquery_dataset_id" {
  description = "BigQuery dataset ID for production environment"
  value       = module.desirelines.bigquery_dataset_id
}

output "storage_bucket_name" {
  description = "Storage bucket name for production environment"
  value       = module.desirelines.storage_bucket_name
}

output "pubsub_topic_name" {
  description = "PubSub topic name for production environment"
  value       = module.desirelines.pubsub_topic_name
}
