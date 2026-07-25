# Ops Scripts

Operational scripts for setup, deployment, data management, and webhook administration.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`setup/`](setup/README.md) | Environment bootstrapping (local dev, cloud projects) |
| [`deploy/`](deploy/README.md) | Deployment scripts (web frontend, secrets, Docker images) |
| [`regions/`](regions/README.md) | Region boundary reference-data loader (Census) |

## Scripts

| Script | Purpose |
|--------|---------|
| `webhook-management.sh` | Manage Strava webhook subscriptions (create, view, delete) |

The webhook script is invoked via just: `just webhook <action> <env>`. See the [Strava Webhook Guide](../../docs/guides/strava-webhook.md).

## Related

- [Bootstrap Guide](../../docs/guides/bootstrap.md) - Full environment setup walkthrough
- [Deployment Guide](../../docs/guides/deployment.md) - Deployment procedures
- [Database Setup](../../docs/guides/database-setup.md) - Database migrations
