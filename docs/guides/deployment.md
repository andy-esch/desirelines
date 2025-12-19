# Deployment Guide

Quick reference for deploying Desirelines services.

## Contents

- [Backend Services](#backend-services) - Cloud Run (dispatcher, apigateway, bq-inserter, postgres-writer)
- [Web Frontend](#web-frontend) - Firebase Hosting
- [Database Migrations](#database-migrations) - Flyway/PostgreSQL
- [Strava Webhook](#strava-webhook) - Webhook subscription
- [Rollback](#rollback) - Reverting deployments
- [Troubleshooting](#troubleshooting)

---

## Backend Services

### Quick Deploy (Dev)

```bash
# 1. Build and push Docker images
make build-publish

# 2. Deploy with Terraform
cd terraform/environments/dev
terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"
```

### Production Deploy

```bash
# 1. Ensure tests pass
make test

# 2. Build with version tag
make build-publish-tag TAG=v1.2.0

# 3. Deploy
cd terraform/environments/prod
terraform apply -var="deployment_version=v1.2.0"

# 4. Update webhook if dispatcher URL changed
make delete-webhook prod && make create-webhook prod
```

### Verify Deployment

```bash
# List services
gcloud run services list --region=us-central1

# Check logs
gcloud run services logs read desirelines-dispatcher --region=us-central1 --limit=20
```

---

## Web Frontend

Deploys to Firebase Hosting.

### Prerequisites

Create `.env.staging.local` or `.env.production.local` (see `packages/web/README.md`).

### Deploy

```bash
# Dev/staging
./scripts/infrastructure/deploy-web.sh dev

# Production
./scripts/infrastructure/deploy-web.sh prod
```

### Manual Deploy

```bash
cd packages/web
npm run build -- --mode production
firebase deploy --only hosting --project your-prod-project
```

---

## Database Migrations

PostgreSQL migrations managed by Flyway.

```bash
# Check status
make db-migrate-dev-info

# Run migrations
make db-migrate-dev
```

See `schemas/database/README.md` for details.

---

## Strava Webhook

```bash
# View current subscription
make view-webhook dev

# Create subscription (after dispatcher deploy)
make create-webhook dev
```

See [strava-webhook.md](./strava-webhook.md) for OAuth2 setup.

---

## Rollback

```bash
# Find previous version
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/PROJECT/desirelines-functions/dispatcher \
  --sort-by=~CREATE_TIME --limit=5

# Deploy previous version
cd terraform/environments/prod
terraform apply -var="deployment_version=PREVIOUS_SHA"
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `denied: Permission denied` | `gcloud auth configure-docker us-central1-docker.pkg.dev` |
| `.env.*.local not found` | Create env file per `packages/web/README.md` |
| Webhook not receiving events | Check OAuth2 auth - see [strava-webhook.md](./strava-webhook.md) |
| `ModuleNotFoundError` | Rebuild images: `make build-publish` then re-apply Terraform |

### Check Service Health

```bash
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(status.conditions)'

gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --filter='severity>=ERROR' --limit=20
```

---

## Related

- [bootstrap.md](./bootstrap.md) - Initial environment setup
- [strava-webhook.md](./strava-webhook.md) - Webhook configuration
- [ci.md](./ci.md) - CI/CD pipeline
