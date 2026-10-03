# Ops Scripts

Operational scripts for setup, deployment, data management, and webhook administration.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`setup/`](setup/README.md) | Environment bootstrapping (local dev, cloud projects) |
| [`deploy/`](deploy/README.md) | Deployment scripts (web frontend, secrets, Docker images) |
| [`regions/`](regions/README.md) | Region boundary reference-data loader (Census) |
| [`routes/`](routes/README.md) | Temporary read-only route-geometry diagnostics |

## Scripts

| Script | Purpose |
|--------|---------|
| `webhook-management.sh` | Manage Strava webhook subscriptions (create, view, delete) |
| `dlq-replay.sh` | Replay dead-lettered messages onto their source topic |
| `count-unstamped-goals.py` | Read-only: count stored goal sections without the canonical-units stamp (`storageVersion: 2`) |
| `_gcp_env.sh` | Sourced helper: environment/project guards and destructive-action confirmation |

The webhook and DLQ scripts are invoked via just: `just webhook <action> <env>` and
`just dlq-replay <service> <env> [--execute]`. See the
[Strava Webhook Guide](../../docs/guides/strava-webhook.md) and
[Redriving a DLQ](../../docs/runbooks/dlq-redrive.md).

`count-unstamped-goals.py` runs directly, with your gcloud login:
`python3 scripts/ops/count-unstamped-goals.py --env prod`. It exits 1 and lists each
section still in display units, or exits 0 when there are none. The web app's goal-unit
migration was retired once the count reached zero, and the app now reads every account
section as canonical, so a non-zero count means something wrote an unstamped section.

## Related

- [Bootstrap Guide](../../docs/guides/bootstrap.md) - Full environment setup walkthrough
- [Deployment Guide](../../docs/guides/deployment.md) - Deployment procedures
- [Database Setup](../../docs/guides/database-setup.md) - Database migrations
