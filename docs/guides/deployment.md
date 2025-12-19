# Deployment Guide

This guide covers deploying Desirelines to Google Cloud Platform (GCP) environments.

## Architecture Overview

Desirelines uses a hybrid serverless architecture:

- **Cloud Run Services** (Go, Docker images):
  - `dispatcher` - Receives Strava webhooks, publishes to PubSub
  - `apigateway` - Serves aggregated data to web frontend
  - `bq-inserter` - Writes activity data to BigQuery
  - `postgres-writer` - Writes activity data to PostgreSQL backend for web frontend

## Prerequisites

- **Google Cloud SDK**: `gcloud` CLI installed and authenticated
- **Docker**: For building Cloud Run images
- **Terraform**: For infrastructure management
- **uv**: Python package manager
- **Git**: For version tagging

Ensure you have appropriate IAM permissions for:

- Artifact Registry (push images)
- Cloud Run (deploy services)
- Secret Manager (read secrets)
- Terraform state bucket (read/write)

## Deployment Process

### 1. Build Cloud Run Images

Build and push Docker images to Artifact Registry:

```bash
# Build all services with current git SHA
make build-publish

# Or build with specific tag
make build-publish-tag TAG=v1.2.3
```

This builds and pushes:

- `dispatcher:TAG` and `dispatcher:latest` (Go)
- `apigateway:TAG` and `apigateway:latest` (Go)
- `bq-inserter:TAG` and `bq-inserter:latest` (Python/FastAPI)
- `postgres-writer:TAG` and `postgres-writer:latest` (Python/FastAPI)

Verify images in Artifact Registry:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$(gcloud config get-value project)/desirelines-functions
```

### 2. Deploy with Terraform

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

- Tags Cloud Run images (e.g., `dispatcher:abc1234`, `bq-inserter:abc1234`)
- Provides code provenance and observability

### 3. Run Database Migrations

Database migrations are managed by Flyway. See `schemas/database/README.md` for full details.

```bash
# Check migration status
make db-migrate-dev-info

# Run migrations
make db-migrate-dev
```

Migrations run automatically in local development via docker-compose (`flyway` service).

### 5. Configure Strava Webhook

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

### 6. Validate Deployment

Check service health:

```bash
# Cloud Run services (dispatcher, apigateway, bq-inserter, postgres-writer)
gcloud run services list --region=us-central1

# Check dispatcher logs
gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --limit=20

# Check bq-inserter logs
gcloud run services logs read desirelines-bq-inserter \
  --region=us-central1 --limit=20

# Check postgres-writer logs
gcloud run services logs read desirelines-postgres-writer \
  --region=us-central1 --limit=20
```

Test end-to-end flow:

1. Create/update activity in Strava
2. Check dispatcher logs show webhook received
3. Check PubSub topic has messages (Eventarc triggers bq-inserter and postgres-writer)
4. Check BigQuery table updated (via bq-inserter)
5. Check PostgreSQL database updated (via postgres-writer)

## Environment-Specific Deployments

### Dev Environment

```bash
# Set GCP project
gcloud config set project desirelines-dev

# Build images and package functions
#  Docker Images are pushed to Artifact Registry
make build-publish

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
make build-publish-tag TAG=v1.2.0

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

### 3. Verify Rollback

```bash
# Check deployed Cloud Run versions
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(spec.template.spec.containers[0].image)'

gcloud run services describe desirelines-bq-inserter \
  --region=us-central1 --format='value(spec.template.spec.containers[0].image)'

gcloud run services describe desirelines-postgres-writer \
  --region=us-central1 --format='value(spec.template.spec.containers[0].image)'
```

## Troubleshooting

### Image Build Failures

**Error:** `failed to solve: failed to read dockerfile`

```bash
# Ensure Dockerfiles exist in package directories
ls packages/dispatcher/Dockerfile
ls packages/apigateway/Dockerfile
ls packages/stravapipe/Dockerfile.bq_inserter
ls packages/stravapipe/Dockerfile.postgres_writer
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
  terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"

  # For Cloud Run services (bq-inserter, postgres-writer), rebuild Docker image
  make build-publish
  terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"
  ```

### Webhook Issues

**Webhook subscription created but no events received:**

- Cause: Missing OAuth2 user authorization
- Solution: See [Strava Webhook Setup Guide](./strava-webhook.md)

**Webhook points to old URL:**

```bash
# Update webhook subscription
make delete-webhook dev
make create-webhook dev
```

### Service Health Checks

```bash
# Cloud Run service status (dispatcher, apigateway, bq-inserter, postgres-writer)
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(status.conditions)'

gcloud run services describe desirelines-bq-inserter \
  --region=us-central1 --format='value(status.conditions)'

gcloud run services describe desirelines-postgres-writer \
  --region=us-central1 --format='value(status.conditions)'

# Check for error logs
gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --filter='severity>=ERROR' --limit=50

gcloud run services logs read desirelines-bq-inserter \
  --region=us-central1 --filter='severity>=ERROR' --limit=50

gcloud run services logs read desirelines-postgres-writer \
  --region=us-central1 --filter='severity>=ERROR' --limit=50
```

## Cost Optimization

Cloud Run services configured for minimal cost:

- **vCPU:** 1 (Go services), 1 (Python services)
- **Memory:** 128Mi (Go services), 256Mi (Python services)
- **Scaling:** 0-1 instances (scale to zero when idle)
- **CPU allocation:** Only during request processing (`cpu_idle = true`)

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

1. **Publish Docker images** - `pants publish` pushes all Cloud Run images to Artifact Registry:
   - Go services: `dispatcher`, `apigateway`
   - Python services: `bq-inserter`, `postgres-writer`
2. **Deploy infrastructure** - Terraform applies changes to dev environment
3. **Tag images** - Uses git SHA for version tracking (e.g., `dispatcher:abc1234`)

**Key feature:** Deployment workflow doesn't re-run tests (branch protection ensures quality).

### Building Artifacts with Pants

**Docker images:**

```bash
# Build and publish all Cloud Run images to Artifact Registry
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish \
  packages/dispatcher:dispatcher \
  packages/apigateway:apigateway \
  packages/stravapipe:bq-inserter \
  packages/stravapipe:postgres-writer

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
- [Docker Guide](./docker.md) - Docker build details and Pants integration
- [Local Testing](./local-testing.md) - Testing before deployment
