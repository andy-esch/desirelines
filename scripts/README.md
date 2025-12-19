# Scripts Directory

Operational scripts for desirelines monorepo management, deployment, and data operations.

## Directory Structure

```
scripts/
├── data/             # Data backfill and migration
├── development/      # Local development tooling
├── infrastructure/   # Environment setup
├── operations/       # Build and deployment
└── schema/           # Schema utilities
```

## Quick Reference

| Task | Command |
|------|---------|
| Local dev setup | `./scripts/development/local-dev/setup-local-environment.sh` |
| Build & publish images | `make build-publish` |
| Deploy secrets | `./scripts/infrastructure/deploy-secrets.sh StravaAuth-dev.json` |
| Create webhook | `./scripts/operations/webhook-management.sh create dev` |
| Backfill from Strava | `uv run python scripts/data/backfill_from_strava.py --years 2024` |
| Migrate BQ→PostgreSQL | `uv run python scripts/data/backfill_bq_to_postgres.py` |

## By Directory

### `data/`

Data backfill and migration scripts. See [scripts/data/README.md](data/README.md).

- `backfill_from_strava.py` - Backfill from Strava API → BigQuery
- `backfill_bq_to_postgres.py` - Migrate BigQuery → PostgreSQL
- `webhook-replay/` - Load testing via webhook replay

### `development/`

Local development environment setup.

- `local-dev/setup-local-environment.sh` - One-command local setup
- `local-dev/bootstrap_pubsub.sh` - PubSub emulator configuration
- `local-dev/cloudevent_adapter.py` - CloudEvent wrapper for local dev
- `api-gateway-tunnel.sh` - SSH tunnel to VPC-only API Gateway

See [scripts/development/local-dev/README.md](development/local-dev/README.md).

### `infrastructure/`

Environment bootstrap and secrets management.

- `bootstrap-environment.sh` - Complete environment bootstrap
- `deploy-secrets.sh` - Deploy secrets to Secret Manager

### `operations/`

Build and deployment tasks.

- `build-and-publish.sh` - Build and push Docker images to Artifact Registry
- `webhook-management.sh` - Manage Strava webhook subscriptions

### `schema/`

Schema utilities.

- `schema_to_bq.py` - Convert JSON schemas to BigQuery CLI format

## Related Documentation

- [Bootstrap Guide](../docs/guides/bootstrap.md)
- [Local Testing Setup](../docs/guides/local-testing.md)
- [Deployment Guide](../docs/guides/deployment.md)
