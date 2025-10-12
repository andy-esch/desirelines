# Environment Bootstrap Guide

This guide shows how to bootstrap a complete desirelines environment (dev or prod) from scratch.

## Prerequisites (5 minutes)

1. **Create GCP project** (manual):
   ```bash
   gcloud projects create desirelines-dev  # or desirelines-prod
   ```

2. **Enable billing** (manual):
   - Go to https://console.cloud.google.com/billing
   - Link the project to your billing account

3. **Create Strava API credentials** (manual):
   - Create `StravaAuth-dev.json` (or `StravaAuth-prod.json`) with your Strava API credentials
   - Format:
     ```json
     {
       "client_id": "your_client_id",
       "client_secret": "your_client_secret",
       "refresh_token": "your_refresh_token"
     }
     ```

## One-Command Bootstrap (5-10 minutes)

```bash
# Bootstrap dev environment
./scripts/operations/bootstrap-environment.sh dev

# Or bootstrap prod environment
./scripts/operations/bootstrap-environment.sh prod
```

That's it! The script will:
1. ✅ Validate prerequisites (project exists, billing enabled)
2. ✅ Create terraform service account with all required permissions
3. ✅ Set up authentication and impersonation
4. ✅ Create terraform state bucket
5. ✅ Deploy secrets to Secret Manager
6. ✅ Package all Cloud Functions
7. ✅ Deploy complete infrastructure (BigQuery, PubSub, Cloud Functions, etc.)

## What Gets Created

### Infrastructure
- **BigQuery datasets**: Raw activities, processed data, aggregated summaries
- **PubSub topics**: Activity processing pipeline
- **Cloud Functions**: 4 functions (dispatcher, bq-inserter, aggregator, api-gateway)
- **Secret Manager**: Strava API credentials
- **Cloud Storage**: Terraform state bucket

### Service Accounts
- **terraform-desirelines**: For infrastructure management (same name across environments)
- **Dedicated function SAs**: Created by Terraform for each function (dispatcher, aggregator, bq-inserter, api-gateway)

## Updating the Environment

After the initial bootstrap, to deploy changes:

```bash
# Package new function code
./scripts/operations/package-functions.sh

# Deploy infrastructure updates
cd terraform/environments/dev  # or prod
terraform apply -var="function_source_tag=$(git rev-parse --short HEAD)"
```

## Troubleshooting

### Common Issues

1. **"Project not found"**
   - Ensure project exists: `gcloud projects list`
   - Check you have access: `gcloud projects describe desirelines-dev`

2. **"Billing not enabled"**
   - Enable billing in console: https://console.cloud.google.com/billing

3. **"StravaAuth-{env}.json not found"**
   - Create the file with your Strava API credentials (see Prerequisites)

4. **Permission errors during terraform apply**
   - If terraform fails with IAM permission errors, the terraform service account may need additional roles
   - The bootstrap script grants comprehensive permissions, but if you created the SA manually, run:
     ```bash
     ./scripts/infrastructure/bootstrap-terraform-sa.sh dev  # to add missing permissions
     ```
   - Ensure you have Owner/Editor role on the project
   - Run: `gcloud auth list` to verify authentication

5. **Cross-project access errors (prod only)**
   - Production environment needs read access to dev project resources
   - Ensure the bootstrap script completed successfully (it grants these permissions automatically)

### Manual Recovery

If the bootstrap script fails partway through, you can run individual steps:

```bash
# Create terraform SA only
./scripts/infrastructure/bootstrap-terraform-sa.sh dev

# Deploy secrets only
./scripts/infrastructure/deploy-secrets.sh StravaAuth-dev.json

# Package functions only
./scripts/operations/package-functions.sh

# Deploy terraform only
cd terraform/environments/dev
terraform init -backend-config="bucket=desirelines-dev-terraform-state"
terraform apply -var="function_source_tag=$(git rev-parse --short HEAD)"
```

## Environment Cleanup

To completely tear down an environment:

```bash
cd terraform/environments/dev  # or prod
terraform destroy
```

This will remove all infrastructure but preserve:
- The terraform state bucket (for safety)
- The terraform service account
- Secrets in Secret Manager
