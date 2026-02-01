# GitHub Actions Workload Identity Federation - Outputs

# ==============================================================================
# GitHub Secrets Configuration
# These values should be added as GitHub repository secrets
# ==============================================================================

output "wif_provider" {
  description = "Workload Identity Provider resource name (add as GitHub secret: WIF_PROVIDER)"
  value       = var.create_pool ? google_iam_workload_identity_pool_provider.github[0].name : ""
}

output "wif_service_account" {
  description = "Service account email for deployments (add as GitHub secret: WIF_SERVICE_ACCOUNT)"
  value       = google_service_account.github_actions_deploy.email
}

# ==============================================================================
# Additional Information
# ==============================================================================

output "workload_identity_pool_id" {
  description = "Workload Identity Pool ID"
  value       = var.create_pool ? google_iam_workload_identity_pool.github_actions[0].workload_identity_pool_id : ""
}

output "workload_identity_pool_name" {
  description = "Workload Identity Pool full resource name"
  value       = local.pool_name
}

output "service_account_id" {
  description = "Service account ID"
  value       = google_service_account.github_actions_deploy.account_id
}

output "service_account_unique_id" {
  description = "Service account unique ID"
  value       = google_service_account.github_actions_deploy.unique_id
}

# ==============================================================================
# Setup Instructions
# ==============================================================================

output "github_secrets_instructions" {
  description = "Instructions for adding GitHub secrets"
  value = (
    var.create_pool
    ? join("\n", [
      "",
      "  Add these secrets to your GitHub repository:",
      "",
      "  1. Go to: https://github.com/${var.github_repository}/settings/secrets/actions",
      "",
      "  2. Add secret WIF_PROVIDER:",
      "     ${google_iam_workload_identity_pool_provider.github[0].name}",
      "",
      "  3. Add secret WIF_SERVICE_ACCOUNT:",
      "     ${google_service_account.github_actions_deploy.email}",
      "",
      "  Then GitHub Actions can authenticate without service account keys!",
    ])
    : "Pool not managed by this module. Configure WIF secrets from the primary module."
  )
}
