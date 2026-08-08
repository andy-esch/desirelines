# Schemas

Data schemas and contracts for the desirelines monorepo.

## Directory Index

| Directory | Purpose | Used By |
|-----------|---------|---------|
| [`activities/`](activities/) | Persisted-field compatibility contract | `stravapipe`, schema contributors |
| [`bigquery/`](bigquery/) | BigQuery table schemas | CDC topic schema, backfill writer (stravapipe) |
| [`database/`](database/) | PostgreSQL migrations (Flyway) | `postgres-writer` (stravapipe), `api-gateway` |
| [`proto/`](proto/) | Protocol Buffer contracts | `api-gateway`, `dispatcher`, `stravapipe`, `web` |
| [`sports/`](sports/) | Sport type configuration | `api-gateway`, `web` frontend |
| [`test-fixtures/`](test-fixtures/) | Shared cross-language test fixtures | `dispatcher`, `stravapipe` |

## Overview

- **Activities**: Test-time compatibility manifest linking detailed and summary
  Strava fields to live ingestion, backfill, PostgreSQL, BigQuery, and required
  historical-data decisions.

- **BigQuery**: JSON schemas defining the `activities` table. Source of truth for BQ table structure.

- **Database**: Flyway migrations for PostgreSQL (Neon-hosted). Shared by `postgres-writer` and `api-gateway`.

- **Proto**: Protocol Buffer definitions for cross-language type sharing:
  - `sports_metrics.proto` - Activity metrics API response (`api-gateway` → `web`)
  - `activities.proto` - Activity read API responses (`api-gateway` → `web`)
  - `user_config.proto` - User settings stored in Firestore (`api-gateway` ↔ `web`)
  - `webhook.proto` - Strava webhook events (`dispatcher` → `stravapipe`)
  - generated `bq_activities.proto` - BigQuery Storage Write row descriptor

  See [`proto/README.md`](proto/README.md) for code generation commands.

- **Sports**: JSON configuration mapping Strava sport types to app categories with their available metrics.

## Related

- [Domain Model](../docs/architecture/domain-model.md) — maps how these schemas manifest as types in each package
- [Persisted Activity Compatibility](activities/) — required workflow for activity-model changes
