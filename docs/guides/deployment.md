# Deployment Guide

This guide covers deploying Desirelines to Google Cloud Platform (GCP) environments.

## Architecture Overview

Desirelines uses a hybrid serverless architecture:

- **Cloud Run Services** (Go, Docker images):
  - `dispatcher` - Receives Strava webhooks, publishes to PubSub
  - `apigateway` - Serves aggregated data to web frontend

- **Cloud Functions v2** (Python, source packages):
  - `bq-inserter` - Writes activity data to BigQuery
  - `aggregator` - Generates summaries and stores in Cloud Storage

## Prerequisites

- **Google Cloud SDK**: `gcloud` CLI installed and authenticated
- **Docker**: For building Cloud Run images
- **Terraform**: For infrastructure management
- **uv**: Python package manager for Cloud Functions
- **Git**: For version tagging

Ensure you have appropriate IAM permissions for:
- Artifact Registry (push images)
- Cloud Run (deploy services)
- Cloud Functions (deploy functions)
- Secret Manager (read secrets)
- Terraform state bucket (read/write)

## Deployment Process

### 1. Build Cloud Run Images

Build and push Docker images to Artifact Registry:

```bash
# Build all services with current git SHA
make build-push-images

# Or build with specific tag
make build-push-images-tag TAG=v1.2.3

# Or use script directly
./scripts/operations/build-push-images.sh          # Uses current git SHA
./scripts/operations/build-push-images.sh abc1234  # Uses specific SHA
```

This builds and pushes:
- `dispatcher:TAG` and `dispatcher:latest`
- `apigateway:TAG` and `apigateway:latest`

Verify images in Artifact Registry:
```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$(gcloud config get-value project)/desirelines-functions
```

### 2. Package Python Cloud Functions

Package Cloud Functions source code:

```bash
./scripts/operations/package-functions.sh
```

This creates zip files in `dist/`:
- `bq-inserter-{SHA}.zip`
- `aggregator-{SHA}.zip`

### 3. Deploy with Terraform

Deploy infrastructure and services:

```bash
# Navigate to environment
cd terraform/environments/dev  # or prod

# Get current git SHA for version tracking
DEPLOY_VERSION=$(git rev-parse --short HEAD)

# Review plan
terraform plan -var="deployment_version=$DEPLOY_VERSION"

# Apply changes
terraform apply -var="deployment_version=$DEPLOY_VERSION"
```

The `deployment_version` variable:
- Tags Cloud Run images (e.g., `dispatcher:abc1234`)
- Names Cloud Function source packages (e.g., `bq-inserter-abc1234.zip`)
- Provides code provenance and observability

### 4. Configure Strava Webhook

After deploying the dispatcher, configure Strava to send webhooks:

```bash
# View current webhook subscription
make view-webhook dev

# Create new webhook subscription (points to Cloud Run URL)
make create-webhook dev

# Verify webhook configuration
make view-webhook dev
```

See [Strava Webhook Setup Guide](./strava-webhook.md) for OAuth2 authorization requirements.

### 5. Validate Deployment

Check service health:

```bash
# Cloud Run services
gcloud run services list --region=us-central1

# Cloud Functions
gcloud functions list --gen2 --region=us-central1

# Check dispatcher logs
gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --limit=20

# Check function logs
gcloud functions logs read activity-bq-inserter \
  --gen2 --region=us-central1 --limit=20
```

Test end-to-end flow:
1. Create/update activity in Strava
2. Check dispatcher logs show webhook received
3. Check PubSub topic has messages
4. Check BigQuery table updated
5. Check Cloud Storage aggregations updated

## Environment-Specific Deployments

### Dev Environment

```bash
# Set GCP project
gcloud config set project desirelines-dev

# Build images
make build-push-images

# Package functions
./scripts/operations/package-functions.sh

# Deploy
cd terraform/environments/dev
terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"

# Configure webhook
make create-webhook dev
```

### Production Environment

**Important:** Follow this checklist for production deployments.

**Pre-Deployment:**
1. ✅ Dev environment fully validated
2. ✅ All tests passing (`make test`)
3. ✅ Code reviewed and merged to main
4. ✅ Git tagged with version (e.g., `v1.2.0`)
5. ✅ Backup current webhook subscription ID

**Deployment:**
```bash
# Set GCP project
gcloud config set project desirelines-prod

# Build production images with version tag
make build-push-images-tag TAG=v1.2.0

# Package functions
./scripts/operations/package-functions.sh

# Deploy infrastructure
cd terraform/environments/prod
terraform plan -var="deployment_version=v1.2.0"
terraform apply -var="deployment_version=v1.2.0"

# Update webhook subscription
make delete-webhook prod  # Remove old webhook
make create-webhook prod  # Create new webhook

# Verify webhook
make view-webhook prod
```

**Post-Deployment:**
1. Monitor Cloud Run logs for errors
2. Check PubSub delivery metrics
3. Verify BigQuery data updates
4. Confirm Cloud Storage aggregations
5. Test web interface

## Rollback Procedure

If issues occur after deployment:

### 1. Identify Previous Version

```bash
# List recent image tags
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/PROJECT/desirelines-functions/dispatcher \
  --sort-by=~CREATE_TIME --limit=5

# Check Terraform state for previous version
cd terraform/environments/prod
terraform show | grep deployment_version
```

### 2. Rollback Cloud Run Services

```bash
# Deploy previous version
cd terraform/environments/prod
terraform apply -var="deployment_version=PREVIOUS_SHA"
```

### 3. Rollback Cloud Functions (if needed)

```bash
# Ensure previous version packages exist
ls dist/bq-inserter-PREVIOUS_SHA.zip
ls dist/aggregator-PREVIOUS_SHA.zip

# Deploy previous version
terraform apply -var="deployment_version=PREVIOUS_SHA"
```

### 4. Verify Rollback

```bash
# Check deployed versions
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(spec.template.spec.containers[0].image)'

gcloud functions describe activity-bq-inserter \
  --gen2 --region=us-central1
```

## Troubleshooting

### Image Build Failures

**Error:** `failed to solve: failed to read dockerfile`
```bash
# Ensure Dockerfile exists in package directory
ls packages/dispatcher/Dockerfile
ls packages/apigateway/Dockerfile
```

**Error:** `denied: Permission denied`
```bash
# Configure Docker authentication
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### Terraform Deployment Issues

**Error:** `Error 400: PORT environment variable is reserved`
- Solution: Cloud Run sets PORT automatically. Remove from `cloud_run.tf`.

**Error:** `No such file: dist/dispatcher-abc1234.zip`
- Solution: Go services use Docker images, not source packages. Remove from `main.tf` locals.

**Error:** `ModuleNotFoundError: No module named 'pydantic'`
- Solution: Stale function deployment. Force redeployment:
  ```bash
  terraform taint 'module.desirelines.google_cloudfunctions2_function.activity_bq_inserter[0]'
  terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"
  ```

### Webhook Issues

**Webhook subscription created but no events received:**
- Cause: Missing OAuth2 user authorization
- Solution: See [Strava Webhook Setup Guide](./strava-webhook.md)

**Webhook points to old Cloud Functions URL:**
```bash
# Update webhook subscription
make delete-webhook dev
make create-webhook dev
```

### Service Health Checks

```bash
# Cloud Run service status
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(status.conditions)'

# Cloud Function status
gcloud functions describe activity-bq-inserter \
  --gen2 --region=us-central1 --format='value(state)'

# Check for error logs
gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --filter='severity>=ERROR' --limit=50
```

## Cost Optimization

Cloud Run services configured for minimal cost:
- **vCPU:** 0.25 (minimum)
- **Memory:** 128Mi (minimum for Go services)
- **Scaling:** 0-1 instances (scale to zero when idle)
- **CPU allocation:** Only during request processing

Monitor costs:
```bash
# Cloud Run billing
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(spec.template.spec.containers[0].resources.limits)'

# Overall project costs
# Visit: https://console.cloud.google.com/billing
```

## CI/CD Integration

### Continuous Integration

All code changes go through automated testing before deployment. See [CI Guide](./ci.md) for details.

**CI workflow** (`.github/workflows/ci-pants.yml`):
- Runs on all pull requests and pushes to main
- Tests: Python (Pants), Go (native), React (npm)
- Linting: ruff (Python), golangci-lint (Go), ESLint (React)
- Type checking: mypy (Python), TypeScript (React)
- Validates: Terraform configs, BUILD files, sport config sync

**Branch protection:** Tests must pass before merging to main.

### Continuous Deployment

Deployment happens automatically on merge to main via `.github/workflows/deploy.yml`.

**Deployment flow:**
1. **Package artifacts** - `pants package functions::` creates Cloud Function zips
2. **Publish images** - `pants publish ::` pushes Docker images to Artifact Registry
3. **Deploy infrastructure** - Terraform applies changes to dev environment
4. **Tag images** - Uses git SHA for version tracking (e.g., `dispatcher:abc1234`)

**Key feature:** Deployment workflow doesn't re-run tests (branch protection ensures quality).

### Building Artifacts with Pants

**Cloud Function packages:**
```bash
# Package all Python functions
pants package functions::

# Creates:
# - dist/functions/bq-inserter.zip
# - dist/functions/aggregator.zip
```

**Docker images:**
```bash
# Build and publish to Artifact Registry
pants publish packages/dispatcher:image packages/apigateway:image

# Uses docker_image() targets in BUILD files
# Tags with git SHA automatically
```

**Benefits:**
- Unified build system (one tool for all artifacts)
- Dependency caching (30-60% faster on repeated builds)
- Explicit dependency tracking (can't deploy stale code)

## Related Documentation

- [CI Guide](./ci.md) - Continuous Integration workflow and testing
- [Bootstrap Guide](./bootstrap.md) - Initial environment setup
- [Strava Webhook Setup](./strava-webhook.md) - OAuth2 and webhook configuration
- [Docker Architecture](../DOCKER.md) - Docker build details
- [Local Testing](./local-testing.md) - Testing before deployment
