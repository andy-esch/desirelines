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

output "pubsub_topic_name" {
  description = "PubSub topic name for production environment"
  value       = module.desirelines.pubsub_topic_name
}

# ==============================================================================
# GitHub Actions CI/CD Outputs
# ==============================================================================

output "github_wif_provider" {
  description = "Workload Identity Provider for GitHub Actions (add as secret: WIF_PROVIDER)"
  value       = module.github_actions.wif_provider
  sensitive   = true
}

output "github_wif_service_account" {
  description = "Service account for GitHub Actions deployments (add as secret: WIF_SERVICE_ACCOUNT)"
  value       = module.github_actions.wif_service_account
}

# ==============================================================================
# Firebase Web App Configuration
# ==============================================================================

output "firebase_web_app_config" {
  description = "Firebase Web App configuration for frontend .env files"
  value       = module.desirelines.firebase_web_app_config
}

# ==============================================================================
# Cloud Run deployment details
# ==============================================================================

output "cloudrun_deployment_urls_details" {
  description = "API Gateway details"
  value       = module.desirelines.cloud_run_urls
}
