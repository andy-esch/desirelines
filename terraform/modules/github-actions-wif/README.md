# GitHub Actions Workload Identity Federation Module

Terraform module to set up Workload Identity Federation for GitHub Actions, enabling secure authentication to GCP without storing service account keys.

## Features

- ✅ **Keyless authentication** - No service account keys in GitHub secrets
- ✅ **Short-lived tokens** - Automatic OIDC token rotation
- ✅ **Repository restrictions** - Only specified GitHub repo can authenticate
- ✅ **Least privilege** - Minimal permissions for deployment tasks
- ✅ **Infrastructure as Code** - Fully reproducible setup

## Usage

### In your environment (e.g., `desirelines-deploy/environments/dev/main.tf`)

```hcl
module "github_actions" {
  source = "../../modules/github-actions-wif"

  project_id        = var.gcp_project_id
  environment       = "dev"
  github_repository = "andy-esch/desirelines"  # Your GitHub repo
}

# Output the values needed for GitHub secrets
output "github_wif_provider" {
  value     = module.github_actions.wif_provider
  sensitive = true
}

output "github_wif_service_account" {
  value = module.github_actions.wif_service_account
}
```

### Apply Terraform

From the `desirelines-deploy` repo:

```bash
cd desirelines-deploy/environments/dev
terraform init
infisical run --env=dev --path=/ci/secrets -- terraform apply

# Get the values for GitHub secrets
infisical run --env=dev --path=/ci/secrets -- terraform output github_wif_provider
infisical run --env=dev --path=/ci/secrets -- terraform output github_wif_service_account
```

### Add GitHub Secrets

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add secret `WIF_PROVIDER` with the value from `terraform output github_wif_provider`
3. Add secret `WIF_SERVICE_ACCOUNT` with the value from `terraform output github_wif_service_account`

### GitHub Actions Workflow

```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
    service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
```

## Variables

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `project_id` | GCP project ID | `string` | - | yes |
| `environment` | Environment name (dev, prod) | `string` | - | yes |
| `github_repository` | GitHub repository (format: owner/repo) | `string` | - | yes |
| `github_repository_owner` | GitHub org/user (auto-extracted if not provided) | `string` | `""` | no |
| `pool_id` | Workload Identity Pool ID | `string` | `"github-actions"` | no |
| `provider_id` | Workload Identity Provider ID | `string` | `"github-oidc"` | no |
| `service_account_id` | Service account ID | `string` | `"github-actions-deploy"` | no |
| `grant_secret_access` | Grant Secret Manager access | `bool` | `false` | no |

## Outputs

| Name | Description |
|------|-------------|
| `wif_provider` | Workload Identity Provider resource name (for GitHub secret) |
| `wif_service_account` | Service account email (for GitHub secret) |
| `workload_identity_pool_id` | Workload Identity Pool ID |
| `service_account_id` | Service account ID |
| `github_secrets_instructions` | Step-by-step setup instructions |

## Permissions Granted

The deployment service account receives these roles:

- `roles/run.developer` - Deploy Cloud Run services
- `roles/artifactregistry.writer` - Push Docker images
- `roles/storage.objectAdmin` - Terraform state and assets
- `roles/iam.serviceAccountUser` - Deploy as other service accounts
- `roles/secretmanager.secretAccessor` - Read secrets
- `roles/viewer` - Verify deployments
- `roles/pubsub.viewer` - Terraform state refresh
- `roles/bigquery.admin` - Terraform state refresh
- `roles/iam.securityReviewer` - Terraform state refresh

## Security Considerations

1. **Repository Restriction**: Only the specified GitHub repository can authenticate (enforced via `attribute_condition`)
2. **No Long-Lived Credentials**: OIDC tokens are short-lived and automatically rotated
3. **Least Privilege**: Service account has only deployment permissions (no data access)
4. **Audit Trail**: All authentication events are logged in GCP Cloud Logging

## Troubleshooting

### Authentication fails in GitHub Actions

**Check Workload Identity Pool exists:**
```bash
gcloud iam workload-identity-pools describe github-actions \
  --location=global \
  --project=YOUR_PROJECT_ID
```

**Verify service account IAM binding:**
```bash
gcloud iam service-accounts get-iam-policy \
  github-actions-deploy@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

**Ensure GitHub secrets are correct:**
- `WIF_PROVIDER` should start with `projects/`
- `WIF_SERVICE_ACCOUNT` should end with `.iam.gserviceaccount.com`

### Permission denied errors

Check the service account has required project roles:
```bash
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:github-actions-deploy@"
```

## References

- [Google Cloud Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [google-github-actions/auth](https://github.com/google-github-actions/auth)
