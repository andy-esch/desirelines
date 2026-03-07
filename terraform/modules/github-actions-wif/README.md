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
# Full deploy SA (default — grants all project-level roles)
module "ci_deploy" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/github-actions-wif?ref=tf-3"

  project_id        = var.gcp_project_id
  environment       = "dev"
  github_repository = "andy-esch/desirelines-deploy"

  service_account_id = "ci-deploy"
}

# Build-only SA (no project-level roles)
module "github_actions" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/github-actions-wif?ref=tf-3"

  project_id          = var.gcp_project_id
  environment         = "dev"
  github_repository   = "andy-esch/desirelines"
  grant_default_roles = false
}
```

### Apply Terraform

From the `desirelines-deploy` repo:

```bash
cd desirelines-deploy/environments/dev
terraform init
infisical run --env=dev --path=/ci/deploy -- terraform apply

# Get the values for GitHub secrets
infisical run --env=dev --path=/ci/deploy -- terraform output github_wif_provider
infisical run --env=dev --path=/ci/deploy -- terraform output github_wif_service_account
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
| `service_account_display_name` | Display name for service account | `string` | `"GitHub Actions Deployment"` | no |
| `pool_display_name` | Display name for Workload Identity Pool | `string` | `"GitHub Actions Pool"` | no |
| `provider_display_name` | Display name for Workload Identity Provider | `string` | `"GitHub OIDC Provider"` | no |
| `grant_default_roles` | Grant the default set of project-level IAM roles (set `false` for build-only SAs) | `bool` | `true` | no |
| `create_pool` | Whether to create the WIF pool and provider (set `false` to reuse existing) | `bool` | `true` | no |
| `workload_identity_pool_name` | Full resource name of existing WIF pool (required when `create_pool=false`) | `string` | `""` | no |
| `additional_project_roles` | Additional project-level IAM roles to grant | `list(string)` | `[]` | no |

## Outputs

| Name | Description |
|------|-------------|
| `wif_provider` | Workload Identity Provider resource name (for GitHub secret) |
| `wif_service_account` | Service account email (for GitHub secret) |
| `workload_identity_pool_id` | Workload Identity Pool ID |
| `service_account_id` | Service account ID |
| `github_secrets_instructions` | Step-by-step setup instructions |

## Permissions Granted

When `grant_default_roles = true` (the default), the service account receives these project-level roles:

- `roles/run.developer` - Deploy Cloud Run services
- `roles/artifactregistry.writer` - Push Docker images
- `roles/storage.objectAdmin` - Terraform state and assets
- `roles/iam.serviceAccountUser` - Deploy as other service accounts
- `roles/secretmanager.secretAccessor` - Read secrets
- `roles/viewer` - Verify deployments
- `roles/pubsub.admin` - Manage Pub/Sub resources
- `roles/bigquery.admin` - Terraform state refresh
- `roles/iam.securityReviewer` - Terraform state refresh
- `roles/iam.serviceAccountAdmin` - Manage SA IAM bindings
- `roles/firebasehosting.admin` - Deploy web frontend

When `grant_default_roles = false`, **no project-level roles** are granted. Use this for build-only service accounts that only need cross-project Artifact Registry access (granted separately).

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
