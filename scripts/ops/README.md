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
| `dlq-replay.sh` | Replay dead-lettered messages onto their source topic |
| `_gcp_env.sh` | Sourced helper: environment/project guards and destructive-action confirmation |

Both are invoked via just: `just webhook <action> <env>` and
`just dlq-replay <service> <env> [--execute]`. See the
[Strava Webhook Guide](../../docs/guides/strava-webhook.md) and
[Redriving a DLQ](../../docs/runbooks/dlq-redrive.md).

## Related

- [Bootstrap Guide](../../docs/guides/bootstrap.md) - Full environment setup walkthrough
- [Deployment Guide](../../docs/guides/deployment.md) - Deployment procedures
- [Database Setup](../../docs/guides/database-setup.md) - Database migrations
