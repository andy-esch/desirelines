# GitHub Actions Workload Identity Federation Setup

Set up Workload Identity Federation for GitHub Actions using Terraform (infrastructure as code).

## Overview

Workload Identity Federation allows GitHub Actions to authenticate to GCP using OIDC tokens instead of long-lived service account keys. This is more secure because:
- ✅ No credentials stored in GitHub secrets
- ✅ Tokens are short-lived and automatically rotated
- ✅ Fine-grained access control based on repo/branch/environment
- ✅ **Fully managed by Terraform** for reproducibility

## Prerequisites

- GCP project: `desirelines-dev` (and later `desirelines-prod`)
- GitHub repository with Actions enabled
- Terraform 1.12+ installed
- `gcloud` CLI authenticated with project owner permissions

## Setup with Terraform (Recommended)

### 1. Configure Terraform Variables

The GitHub repository is already configured in `terraform/environments/dev/variables.tf`:

```hcl
variable "github_repository" {
  description = "GitHub repository for CI/CD (format: owner/repo)"
  type        = string
  default     = "andy-esch/desirelines"
}
```

If your repository is different, update `terraform/environments/dev/terraform.tfvars`:

```hcl
github_repository = "your-org/your-repo"
```

### 2. Apply Terraform

```bash
cd terraform/environments/dev
terraform init
terraform apply
```

This creates:
- Workload Identity Pool (`github-actions`)
- Workload Identity Provider (`github-oidc`)
- Service Account (`github-actions-deploy@desirelines-dev.iam.gserviceaccount.com`)
- All necessary IAM bindings

### 3. Get GitHub Secrets Values

After Terraform completes:

```bash
# Get the Workload Identity Provider (sensitive output)
terraform output github_wif_provider

# Get the Service Account email
terraform output github_wif_service_account

# Get step-by-step instructions
terraform output github_secrets_setup
```

### 4. Add GitHub Repository Secrets

1. Go to: `https://github.com/your-org/your-repo/settings/secrets/actions`

2. Add secret `WIF_PROVIDER`:
   - Value from `terraform output -raw github_wif_provider`
   - Example: `projects/123456789/locations/global/workloadIdentityPools/github-actions/providers/github-oidc`

3. Add secret `WIF_SERVICE_ACCOUNT`:
   - Value from `terraform output github_wif_service_account`
   - Example: `github-actions-deploy@desirelines-dev.iam.gserviceaccount.com`

### 5. Test the Deployment

Create a test PR, merge it to main, and watch `.github/workflows/deploy.yml` run:

1. ✅ Authenticates via Workload Identity (no keys!)
2. ✅ Packages Cloud Functions
3. ✅ Builds and publishes Docker images
4. ✅ Deploys via Terraform
5. ✅ Verifies endpoints

## Repeat for Production

For production environment (`desirelines-prod`):

```bash
cd terraform/environments/prod

# Update terraform.tfvars if needed
terraform apply

# Get secrets
terraform output github_wif_provider
terraform output github_wif_service_account
```

Then add `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` secrets to GitHub (can use same secrets for both envs or separate them).

## Permissions Granted

The Terraform module grants these roles to the service account:

- `roles/run.admin` - Deploy Cloud Run services
- `roles/cloudfunctions.admin` - Deploy Cloud Functions
- `roles/artifactregistry.writer` - Push Docker images
- `roles/storage.objectAdmin` - Upload Cloud Function source
- `roles/iam.serviceAccountUser` - Deploy as other service accounts
- `roles/cloudbuild.builds.editor` - Cloud Functions v2 builds

## Manual Setup (Not Recommended)

<details>
<summary>Click to expand manual gcloud commands (use Terraform instead!)</summary>

### Create Workload Identity Pool

```bash
gcloud config set project desirelines-dev

gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --description="Workload Identity Pool for GitHub Actions" \
  --display-name="GitHub Actions Pool"
```

### Create Provider

```bash
GITHUB_REPO="andy-esch/desirelines"

gcloud iam workload-identity-pools providers create-oidc "github-oidc" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == '${GITHUB_REPO%%/*}'"
```

### Create Service Account

```bash
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deployment"

SA_EMAIL="github-actions-deploy@desirelines-dev.iam.gserviceaccount.com"

# Grant permissions (see Terraform module for complete list)
gcloud projects add-iam-policy-binding desirelines-dev \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"
# ... (repeat for other roles)
```

### Allow Impersonation

```bash
WORKLOAD_IDENTITY_POOL="projects/$(gcloud config get-value project --quiet)/locations/global/workloadIdentityPools/github-actions"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL}/attribute.repository/${GITHUB_REPO}"
```

</details>

## Troubleshooting

### Authentication Fails in GitHub Actions

**Check Terraform outputs:**
```bash
cd terraform/environments/dev
terraform output github_wif_provider
terraform output github_wif_service_account
```

**Verify resources exist:**
```bash
# List workload identity pools
gcloud iam workload-identity-pools list --location=global

# Check service account
gcloud iam service-accounts describe \
  github-actions-deploy@desirelines-dev.iam.gserviceaccount.com
```

**Verify IAM binding:**
```bash
gcloud iam service-accounts get-iam-policy \
  github-actions-deploy@desirelines-dev.iam.gserviceaccount.com
```

### Permission Denied Errors

Check service account permissions:
```bash
gcloud projects get-iam-policy desirelines-dev \
  --flatten="bindings[].members" \
  --filter="bindings.members:github-actions-deploy@"
```

### Recreate from Terraform

If something is misconfigured:

```bash
cd terraform/environments/dev

# Destroy and recreate
terraform destroy -target=module.github_actions
terraform apply
```

## Security Best Practices

1. ✅ **Infrastructure as Code** - Managed by Terraform for reproducibility
2. ✅ **No keys stored** - Workload Identity uses short-lived OIDC tokens
3. ✅ **Principle of least privilege** - Grant only required roles
4. ✅ **Repository restrictions** - Enforced via `attribute_condition`
5. ✅ **Environment protection** - Use GitHub Environments for prod
6. ✅ **Audit logging** - All authentication in Cloud Logging

## Module Documentation

See `terraform/modules/github-actions-wif/README.md` for:
- Module variables and outputs
- Permissions granted
- Security considerations
- Advanced configuration

## References

- [Google Cloud Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [google-github-actions/auth](https://github.com/google-github-actions/auth)
