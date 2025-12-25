# Outputs for dev environment

output "application_config" {
  description = "Configuration values for dev"
  value       = module.desirelines.application_config
}

output "resource_names" {
  description = "All resource names for dev environment"
  value       = module.desirelines.resource_names
}

# Specific outputs that match current application expectations
output "bigquery_dataset_id" {
  description = "BigQuery dataset ID for dev environment"
  value       = module.desirelines.bigquery_dataset_id
}

output "pubsub_topic_name" {
  description = "PubSub topic name for dev environment"
  value       = module.desirelines.pubsub_topic_name
}

# ==============================================================================
# Firebase Web App Configuration
# ==============================================================================

output "firebase_web_app_config" {
  description = "Firebase Web App configuration for frontend .env files"
  sensitive   = true
  value       = module.desirelines.firebase_web_app_config
}

# ==============================================================================
# Cloud Run deployment details
# ==============================================================================

output "cloudrun_deployment_urls_details" {
  description = "Cloud Run service URLs and deployment info"
  value       = module.desirelines.cloud_run_urls
}

# ==============================================================================
# GitHub Actions CI/CD
# ==============================================================================

output "github_actions_service_account_email" {
  description = "GitHub Actions service account email (needed for artifacts project IAM)"
  value       = module.github_actions.wif_service_account
}
