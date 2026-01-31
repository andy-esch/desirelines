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

WIF configuration is managed in the `desirelines-deploy` repo. The GitHub repository is configured in the environment's `terraform.tfvars`.

### 2. Apply Terraform

From the `desirelines-deploy` repo:

```bash
cd desirelines-deploy/environments/dev
terraform init
infisical run --env=dev --path=/ci/secrets -- terraform apply
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
2. ✅ Builds and publishes Docker images
3. ✅ Deploys via Terraform
4. ✅ Verifies endpoints

## Repeat for Production

For production environment (`desirelines-prod`), from the `desirelines-deploy` repo:

```bash
cd desirelines-deploy/environments/prod
terraform init
infisical run --env=prod --path=/ci/secrets -- terraform apply
```

WIF secrets (`WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`) are synced to GitHub via Infisical, scoped per environment.

## Permissions Granted

The Terraform module grants these roles to the service account:

- `roles/run.admin` - Deploy Cloud Run services
- `roles/artifactregistry.writer` - Push Docker images
- `roles/storage.objectAdmin` - Terraform state and assets
- `roles/iam.serviceAccountUser` - Deploy as other service accounts

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

**Check Terraform outputs** (from `desirelines-deploy` repo):
```bash
cd desirelines-deploy/environments/dev
infisical run --env=dev --path=/ci/secrets -- terraform output github_wif_provider
infisical run --env=dev --path=/ci/secrets -- terraform output github_wif_service_account
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

If something is misconfigured (from `desirelines-deploy` repo):

```bash
cd desirelines-deploy/environments/dev

# Destroy and recreate
infisical run --env=dev --path=/ci/secrets -- terraform destroy -target=module.github_actions
infisical run --env=dev --path=/ci/secrets -- terraform apply
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
