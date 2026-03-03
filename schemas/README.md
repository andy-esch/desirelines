# Schemas

Data schemas and contracts for the desirelines monorepo.

## Directory Index

| Directory | Purpose | Used By |
|-----------|---------|---------|
| [`bigquery/`](bigquery/) | BigQuery table schemas | `bq-inserter` (stravapipe) |
| [`database/`](database/) | PostgreSQL migrations (Flyway) | `postgres-writer` (stravapipe), `api-gateway` |
| [`proto/`](proto/) | Protocol Buffer contracts | `api-gateway`, `dispatcher`, `stravapipe`, `web` |
| [`sports/`](sports/) | Sport type configuration | `api-gateway`, `web` frontend |
| [`test-fixtures/`](test-fixtures/) | Shared cross-language test fixtures | `dispatcher`, `stravapipe` |

## Overview

- **BigQuery**: JSON schemas defining the `activities` and `deleted_activities` tables. Source of truth for BQ table structure.

- **Database**: Flyway migrations for PostgreSQL (Neon-hosted). Shared by `postgres-writer` and `api-gateway`.

- **Proto**: Protocol Buffer definitions for cross-language type sharing:
  - `sports_metrics.proto` - Activity metrics API response (`api-gateway` → `web`)
  - `user_config.proto` - User settings stored in Firestore (`api-gateway` ↔ `web`)
  - `webhook.proto` - Strava webhook events (`dispatcher` → `stravapipe`)

  See [`proto/README.md`](proto/README.md) for code generation commands.

- **Sports**: JSON configuration mapping Strava sport types to app categories with their available metrics.

## Related

- [Domain Model](../docs/architecture/domain-model.md) — maps how these schemas manifest as types in each package
