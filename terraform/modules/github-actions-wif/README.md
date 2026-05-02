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
# Terraform-applying SA — default build-deploy roles + infrastructure roles
module "ci_deploy" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/github-actions-wif?ref=tf-N"

  project_id        = var.gcp_project_id
  environment       = "dev"
  github_repository = "andy-esch/desirelines-deploy"

  service_account_id = "ci-deploy"

  additional_project_roles = [
    "roles/secretmanager.admin",
    "roles/resourcemanager.projectIamAdmin",
    # ... other roles needed for terraform apply
  ]
}

# Build-only SA (no project-level roles)
module "github_actions" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/github-actions-wif?ref=tf-N"

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

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.12 |
| <a name="requirement_google"></a> [google](#requirement\_google) | ~> 7.22 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_google"></a> [google](#provider\_google) | 7.30.0 |

## Resources

| Name | Type |
|------|------|
| [google_iam_workload_identity_pool.github_actions](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iam_workload_identity_pool) | resource |
| [google_iam_workload_identity_pool_provider.github](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iam_workload_identity_pool_provider) | resource |
| [google_project_iam_member.additional_roles](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.artifact_registry_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.firebase_hosting_admin](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.run_developer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.service_account_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.viewer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_service_account.github_actions_deploy](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account_iam_member.workload_identity_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_environment"></a> [environment](#input\_environment) | Environment name (dev, prod, etc.) | `string` | n/a | yes |
| <a name="input_github_repository"></a> [github\_repository](#input\_github\_repository) | GitHub repository in format 'owner/repo' (e.g., 'andy-esch/desirelines') | `string` | n/a | yes |
| <a name="input_project_id"></a> [project\_id](#input\_project\_id) | GCP project ID | `string` | n/a | yes |
| <a name="input_additional_project_roles"></a> [additional\_project\_roles](#input\_additional\_project\_roles) | Additional project-level IAM roles to grant the service account | `list(string)` | `[]` | no |
| <a name="input_create_pool"></a> [create\_pool](#input\_create\_pool) | Whether to create the WIF pool and provider (set false to reuse existing) | `bool` | `true` | no |
| <a name="input_github_repository_owner"></a> [github\_repository\_owner](#input\_github\_repository\_owner) | GitHub repository owner (extracted from github\_repository if not provided) | `string` | `""` | no |
| <a name="input_grant_default_roles"></a> [grant\_default\_roles](#input\_grant\_default\_roles) | Whether to grant the default set of project-level IAM roles (set false for build-only SAs) | `bool` | `true` | no |
| <a name="input_pool_display_name"></a> [pool\_display\_name](#input\_pool\_display\_name) | Display name for Workload Identity Pool | `string` | `"GitHub Actions Pool"` | no |
| <a name="input_pool_id"></a> [pool\_id](#input\_pool\_id) | Workload Identity Pool ID | `string` | `"github-actions"` | no |
| <a name="input_provider_display_name"></a> [provider\_display\_name](#input\_provider\_display\_name) | Display name for Workload Identity Provider | `string` | `"GitHub OIDC Provider"` | no |
| <a name="input_provider_id"></a> [provider\_id](#input\_provider\_id) | Workload Identity Provider ID | `string` | `"github-oidc"` | no |
| <a name="input_service_account_display_name"></a> [service\_account\_display\_name](#input\_service\_account\_display\_name) | Display name for deployment service account | `string` | `"GitHub Actions Deployment"` | no |
| <a name="input_service_account_id"></a> [service\_account\_id](#input\_service\_account\_id) | Service account ID for GitHub Actions deployments | `string` | `"github-actions-deploy"` | no |
| <a name="input_workload_identity_pool_name"></a> [workload\_identity\_pool\_name](#input\_workload\_identity\_pool\_name) | Full resource name of existing WIF pool (required when create\_pool=false) | `string` | `""` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_github_secrets_instructions"></a> [github\_secrets\_instructions](#output\_github\_secrets\_instructions) | Instructions for adding GitHub secrets |
| <a name="output_service_account_id"></a> [service\_account\_id](#output\_service\_account\_id) | Service account ID |
| <a name="output_service_account_unique_id"></a> [service\_account\_unique\_id](#output\_service\_account\_unique\_id) | Service account unique ID |
| <a name="output_wif_provider"></a> [wif\_provider](#output\_wif\_provider) | Workload Identity Provider resource name (add as GitHub secret: WIF\_PROVIDER) |
| <a name="output_wif_service_account"></a> [wif\_service\_account](#output\_wif\_service\_account) | Service account email for deployments (add as GitHub secret: WIF\_SERVICE\_ACCOUNT) |
| <a name="output_workload_identity_pool_id"></a> [workload\_identity\_pool\_id](#output\_workload\_identity\_pool\_id) | Workload Identity Pool ID |
| <a name="output_workload_identity_pool_name"></a> [workload\_identity\_pool\_name](#output\_workload\_identity\_pool\_name) | Workload Identity Pool full resource name |
<!-- END_TF_DOCS -->

## Permissions Granted

When `grant_default_roles = true` (the default), the service account receives these build-deploy roles:

- `roles/run.developer` - Deploy Cloud Run services
- `roles/artifactregistry.writer` - Push Docker images
- `roles/iam.serviceAccountUser` - Deploy as other service accounts
- `roles/viewer` - Verify deployments
- `roles/firebasehosting.admin` - Deploy web frontend

When `grant_default_roles = false`, **no project-level roles** are granted. Use this for build-only service accounts that only need cross-project Artifact Registry access (granted separately).

For Terraform-applying SAs (e.g., `ci-deploy`), add infrastructure roles via `additional_project_roles`.

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
