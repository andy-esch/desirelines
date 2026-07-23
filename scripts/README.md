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

| Task            | Command                                               |
| --------------- | ----------------------------------------------------- |
| Local dev setup | `./scripts/ops/setup/setup-local.sh`                  |
| Build & publish | `just build-publish`                                  |
| Deploy web      | `just deploy-web <env>`                               |
| Deploy backend  | Merge to main (auto) or via `desirelines-deploy` repo |
| Manage webhook  | `just webhook <action> <env>`                         |

## By Directory

### `ops/`

Consolidated operational scripts.

- **`ops/setup/`**: Bootstrapping (`bootstrap-environment.sh`, `setup-local.sh`)
- **`ops/deploy/`**: Deployment (`deploy-web.sh`, `build-and-publish.sh`)
- **`ops/backfills/`**: Data tools
- **`ops/webhook-management.sh`**: Webhook operations (create, view, delete)

### `database/`

Database connection and migration helpers (PostgreSQL).

- `connect.sh` - Connect via psql
- `migrate.sh` - Run Flyway migrations

### `development/`

Local development environment setup.

## Related Documentation

- [Bootstrap Guide](../docs/guides/bootstrap.md)
- [Deployment Guide](../docs/guides/deployment.md)
- [Secrets Guide](../docs/guides/secrets.md)
