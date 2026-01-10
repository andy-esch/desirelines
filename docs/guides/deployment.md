# Deployment Guide

Quick reference for deploying Desirelines services.

## Contents

- [CI/CD (Preferred)](#cicd-preferred)
- [Backend Services](#backend-services) - Cloud Run
- [Web Frontend](#web-frontend) - Firebase Hosting
- [Database Migrations](#database-migrations) - Flyway
- [Strava Webhook](#strava-webhook)
- [Rollback](#rollback)
- [Troubleshooting](#troubleshooting)

---

## CI/CD (Preferred)

Deployments should go through CI/CD when possible.

| Action | Trigger |
|--------|---------|
| Deploy to dev | Merge PR to main (automatic) |
| Deploy to prod | Manual workflow dispatch in GitHub Actions |

See [ci.md](./ci.md) for workflow details.

---

## Backend Services

### Dev Deploy (Manual)

```bash
# Build and push images
make build-publish

# Plan and apply
make tf-dev-plan
make tf-dev-apply  # requires typing "dev"
```

### Prod Deploy (Manual)

```bash
# Ensure tests pass
make test

# Build with version
make build-publish

# Plan and apply
make tf-prod-plan
make tf-prod-apply  # requires typing "production"

# Update webhook if dispatcher URL changed
make delete-webhook prod && make create-webhook prod
```

### Check for Drift

```bash
make tf-dev-drift   # Quick drift check
make tf-prod-drift
```

### Verify Deployment

```bash
gcloud run services list --region=us-central1
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
just deploy-web dev

# Production
just deploy-web prod
```

---

## Database Migrations

PostgreSQL migrations managed by Flyway.

```bash
make db-migrate-dev-info  # Check status
make db-migrate-dev       # Run migrations
```

See `schemas/database/README.md` for details.

---

## Strava Webhook

```bash
make view-webhook dev      # View current subscription
make create-webhook dev    # Create subscription
```

See [strava-webhook.md](./strava-webhook.md) for OAuth2 setup.

---

## Rollback

```bash
# Find previous version
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/dispatcher \
  --sort-by=~CREATE_TIME --limit=5

# Deploy previous version via CI/CD or:
cd terraform/environments/prod
terraform apply -var="deployment_version=PREVIOUS_SHA"
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `denied: Permission denied` | `gcloud auth configure-docker us-central1-docker.pkg.dev` |
| `.env.*.local not found` | Create env file per `packages/web/README.md` |
| Webhook not receiving events | Check OAuth2 - see [strava-webhook.md](./strava-webhook.md) |
| `ModuleNotFoundError` | Rebuild: `make build-publish` then `make tf-dev-apply` |

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
- [terraform/README.md](../../terraform/README.md) - Terraform operations
