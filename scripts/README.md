# Scripts Directory

Operational scripts for desirelines monorepo management, deployment, and data operations.

## Directory Structure

```
scripts/
├── ci/               # Release image inputs, validation and regression tests
├── database/         # Database connection/migration (PostgreSQL)
├── development/      # Local development tooling
└── ops/              # Operational scripts (Setup, Deploy, Regions)
    ├── deploy/       # Deployment scripts
    ├── regions/      # Region boundary reference-data loader (Census)
    └── setup/        # Bootstrap scripts
```

## Quick Reference

| Task                | Command                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev setup     | `./scripts/ops/setup/setup-local.sh`                                                                                                                                 |
| Build & publish     | `just build-publish`                                                                                                                                                 |
| Deploy web          | `just deploy-web <env>`                                                                                                                                              |
| Deploy backend      | Merge to main (auto) or via `desirelines-deploy` repo                                                                                                                |
| Backfill activities | `gcloud run jobs execute desirelines-backfill --set-env-vars ATHLETE_ID=<id>,BACKFILL_YEARS=2024` (see `packages/stravapipe/src/stravapipe/cloudrun/backfill_job.py`) |
| Manage webhook      | `just webhook <action> <env>`                                                                                                                                        |
| Redrive a DLQ       | `just dlq-replay <service> <env> [--execute]` (see [Redriving a DLQ](../docs/runbooks/dlq-redrive.md))                                                                |

## By Directory

### `ci/`

- **`image-build-inputs.json`**: Conservative, versioned per-image Git input policy.
- **`image_release.py`**: Select image builds across a push and validate the pushed
  digest against its full-SHA registry tag. Requires Python stdlib and Git; digest
  validation also requires authenticated `gcloud`.
- **`test_image_release.py`**: Local selection, failure propagation and workflow
  contract tests. Run `just ci-test`, `just ci-lint` and `just ci-typecheck`.

Keep the catalog aligned with Dockerfile COPY inputs, build contexts, ignore
rules and shared build tooling. A new input must trigger a rebuild; these
conservative package comparisons may also rebuild for a package docs/test change.

### `ops/`

Consolidated operational scripts.

- **`ops/setup/`**: Bootstrapping (`bootstrap-environment.sh`, `setup-local.sh`)
- **`ops/deploy/`**: Deployment (`deploy-web.sh`, `build-and-publish.sh`)
- **`ops/regions/`**: Region boundary reference-data loader (`load_census_regions.py`)
- **`ops/webhook-management.sh`**: Webhook operations (create, view, delete)
- **`ops/dlq-replay.sh`**: DLQ redrive (pull, republish to source topic, ack)
- **`ops/check-strava-sports.py`**: Strava sport-type drift detector
- **`ops/count-unstamped-goals.py`**: Read-only count of stored goal sections not yet in canonical units

Historical backfills now run as the `desirelines-backfill` Cloud Run job
(`packages/stravapipe/src/stravapipe/cloudrun/backfill_job.py`); the old
one-off `scripts/ops/backfills/` scripts were retired 2026-06-05.

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
