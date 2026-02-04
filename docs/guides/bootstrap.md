# Environment Bootstrap Guide

This guide shows how to bootstrap a complete desirelines environment (dev or prod) from scratch.

## Prerequisites

1. **Create GCP project** (manual):
   ```bash
   gcloud projects create desirelines-dev  # or desirelines-prod
   ```

2. **Enable billing** (manual):
   - Go to https://console.cloud.google.com/billing
   - Link the project to your billing account

3. **Set up Infisical** (manual):
   - Ensure you have access to the Desirelines Infisical project
   - Install the CLI: `brew install infisical/tap/infisical`
   - Log in: `infisical login`
   - Populate secrets in `/backend/secrets` and config in `/backend/config` for your environment
   - Configure GCP Secret Manager sync in Infisical dashboard
   - See [secrets.md](./secrets.md) for details

## One-Command Bootstrap

```bash
./scripts/ops/setup/bootstrap-environment.sh dev
```

The script will:
1. Validate prerequisites (project exists, billing enabled)
2. Create terraform service account with required permissions
3. Set up authentication and impersonation
4. Create terraform state bucket
5. Verify Infisical secrets are configured
6. Build and publish Docker images
7. Deploy complete infrastructure

## What Gets Created

### Infrastructure
- **BigQuery datasets**: Raw activities (analytics/archival)
- **PubSub topics**: Activity processing pipeline with dead letter queues
- **Cloud Run services**: dispatcher, api-gateway, bq-inserter, postgres-writer
- **Firestore database**: User configuration storage (goals, annotations)
- **Firebase Hosting**: Web frontend hosting with custom domain (prod)
- **Secret Manager**: Secret containers (values synced from Infisical)
- **Cloud Storage**: Terraform state bucket
- **Monitoring**: Dashboard and alert policies for DLQ, errors, latency

### Service Accounts
- **terraform-desirelines**: For infrastructure management
- **Dedicated service account per Cloud Run service** (dispatcher, bq-inserter, api-gateway, postgres-writer)
- **infisical-sync**: For Infisical to sync secrets to GCP

## Updating the Environment

After the initial bootstrap, deploy changes by merging to main (auto-deploys to dev).

For manual deployment, use the `desirelines-deploy` repo:

```bash
cd desirelines-deploy/environments/dev
infisical run --env=dev --path=/ci/secrets -- terraform plan
infisical run --env=dev --path=/ci/secrets -- terraform apply
```

## Troubleshooting

### Common Issues

1. **"Project not found"**
   - Ensure project exists: `gcloud projects list`
   - Check you have access: `gcloud projects describe desirelines-dev`

2. **"Billing not enabled"**
   - Enable billing in console: https://console.cloud.google.com/billing

3. **Secrets not found**
   - Verify Infisical sync is configured and working
   - Check secrets exist: `gcloud secrets list --project=desirelines-dev`
   - See [secrets.md](./secrets.md) for setup instructions

4. **Permission errors during terraform apply**
   - The terraform service account may need additional roles
   - Run: `./scripts/ops/setup/bootstrap-terraform-sa.sh dev`
   - Ensure you have Owner/Editor role on the project

### Manual Recovery

If the bootstrap script fails partway through:

```bash
# Create terraform SA only
./scripts/ops/setup/bootstrap-terraform-sa.sh dev

# Build and publish images
just build-publish

# Deploy terraform only (from desirelines-deploy repo)
cd desirelines-deploy/environments/dev
terraform init
infisical run --env=dev --path=/ci/secrets -- terraform apply
```

## Environment Cleanup

To completely tear down an environment (from `desirelines-deploy` repo):

```bash
cd desirelines-deploy/environments/dev  # or prod
infisical run --env=dev --path=/ci/secrets -- terraform destroy
```

This removes all infrastructure but preserves:
- The terraform state bucket (for safety)
- The terraform service account
- Secrets in Secret Manager (managed by Infisical)

## Related

- [secrets.md](./secrets.md) - Secrets management with Infisical
- [deployment.md](./deployment.md) - Deployment procedures
