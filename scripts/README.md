# Scripts Directory

Operational scripts for desirelines monorepo management, deployment, and data operations.

## Directory Structure

```
scripts/
├── infrastructure/   # Environment setup and deployment
├── development/      # Local development tooling
├── data/            # Data operations and backfill
└── operations/      # Build and deployment tasks
```

## Infrastructure Scripts

**Location:** `infrastructure/`

### bootstrap-environment.sh
Complete environment bootstrap from scratch. Creates GCP project resources, enables APIs, configures Terraform backend.

```bash
./scripts/infrastructure/bootstrap-environment.sh dev
./scripts/infrastructure/bootstrap-environment.sh prod
```

See [Bootstrap Guide](../docs/guides/bootstrap.md) for details.

### bootstrap-terraform-sa.sh
Create and configure Terraform service account with required permissions.

```bash
./scripts/infrastructure/bootstrap-terraform-sa.sh <project-id>
```

### deploy-secrets.sh
Deploy Strava authentication secrets to Cloud Functions secret volumes.

```bash
./scripts/infrastructure/deploy-secrets.sh StravaAuth-dev.json
./scripts/infrastructure/deploy-secrets.sh StravaAuth-prod.json
```

## Development Scripts

**Location:** `development/`

### setup_local_testing.sh
Initialize local Docker Compose development environment with PubSub emulator.

```bash
./scripts/development/setup_local_testing.sh
```

See [Local Testing Setup](../docs/guides/local-testing.md) for details.

### api-gateway-tunnel.sh
Create SSH tunnel to access VPC-only API Gateway from local machine.

```bash
./scripts/development/api-gateway-tunnel.sh
```

### local-dev/
Docker Compose helpers for hybrid local development (local functions + live GCP resources).

- `bootstrap_bigquery.sh` - Create BigQuery datasets
- `bootstrap_pubsub.sh` - Configure PubSub topics and subscriptions
- `setup-local-environment.sh` - One-command local environment setup

## Data Scripts

**Location:** `data/`

### backfill_activities.go
Restore historical activity data by replaying webhook events from old system to new environment.

```bash
# Production backfill
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=prod \
  --start-date=2024-01-01 \
  --end-date=2024-12-31

# Dev fixtures
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=dev \
  --limit=50
```

See [Backfill Guide](../docs/guides/backfill.md) for details.

## Operations Scripts

**Location:** `operations/`

### package-functions.sh
Package Cloud Functions into deployment-ready zip files.

```bash
./scripts/operations/package-functions.sh
```

Creates zip files in `dist/` directory for each function.

### webhook-management.sh
Manage Strava webhook subscriptions (create, list, delete).

```bash
# List subscriptions
./scripts/operations/webhook-management.sh list

# Create subscription
./scripts/operations/webhook-management.sh create <callback-url>

# Delete subscription
./scripts/operations/webhook-management.sh delete <subscription-id>
```

## Common Workflows

### New Environment Setup
```bash
# 1. Bootstrap GCP project
./scripts/infrastructure/bootstrap-environment.sh dev

# 2. Deploy secrets
./scripts/infrastructure/deploy-secrets.sh StravaAuth-dev.json

# 3. Deploy infrastructure
cd terraform/environments/dev
terraform apply
```

### Local Development
```bash
# 1. Setup local environment
./scripts/development/setup_local_testing.sh

# 2. Start services
cd web-app
docker compose up
```

### Production Deployment
```bash
# 1. Package functions
./scripts/operations/package-functions.sh

# 2. Apply terraform
cd terraform/environments/prod
terraform apply

# 3. Verify webhook subscription
./scripts/operations/webhook-management.sh list
```

### Data Backfill
```bash
# 1. Test with small dataset (dev)
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=dev \
  --limit=10

# 2. Full backfill (prod)
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=prod \
  --start-date=2024-01-01 \
  --end-date=2024-12-31
```

## Related Documentation

- [Bootstrap Guide](../docs/guides/bootstrap.md) - Environment setup details
- [Backfill Guide](../docs/guides/backfill.md) - Data restoration process
- [Local Testing Setup](../docs/guides/local-testing.md) - Docker development
