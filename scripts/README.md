# Scripts Directory

Operational scripts for desirelines monorepo management, deployment, and data operations.

## Directory Structure

```
scripts/
├── database/         # Database connection/migration (PostgreSQL)
├── development/      # Local development tooling
└── ops/              # Operational scripts (Setup, Deploy, Backfills)
    ├── backfills/    # Data backfill/migration
    ├── deploy/       # Deployment scripts
    └── setup/        # Bootstrap scripts
```

## Quick Reference

| Task | Command |
|------|---------|
| Local dev setup | `./scripts/ops/setup/setup-local.sh` |
| Build & publish | `pants publish ::` |
| Deploy web | `just deploy-web <env>` |
| Deploy secrets | `./scripts/ops/deploy/deploy-secrets.sh StravaAuth-dev.json` |
| Backfill Strava | `uv run python scripts/ops/backfills/backfill_from_strava.py --years 2024` |

## By Directory

### `ops/`

Consolidated operational scripts.

- **`ops/setup/`**: Bootstrapping (`bootstrap-environment.sh`, `setup-local.sh`).
- **`ops/deploy/`**: Deployment (`deploy-web.sh`, `deploy-secrets.sh`).
- **`ops/backfills/`**: Data tools (`backfill_from_strava.py`).
- **`ops/webhook-management.sh`**: Webhook operations.

### `database/`

Database connection and migration helpers (PostgreSQL).

- `connect.sh` - Connect via psql
- `migrate.sh` - Run Flyway migrations

### `development/`

Local development environment setup.

- `local-dev/` - Docker-compose helpers (under review).

## Related Documentation

- [Bootstrap Guide](../docs/guides/bootstrap.md)
- [Deployment Guide](../docs/guides/deployment.md)