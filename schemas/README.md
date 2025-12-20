# Schemas

Data schemas and contracts for the desirelines monorepo.

## Directory Index

| Directory | Purpose | Used By |
|-----------|---------|---------|
| [`bigquery/`](bigquery/) | BigQuery table schemas | `bq-inserter` (stravapipe) |
| [`database/`](database/) | PostgreSQL migrations (Flyway) | `postgres-writer` (stravapipe), `api-gateway` |
| [`proto/`](proto/) | Protocol Buffer contracts | `api-gateway` ↔ `web` frontend |
| [`sports/`](sports/) | Sport type configuration | `api-gateway`, `web` frontend |

## Overview

- **BigQuery**: JSON schemas defining the `activities` and `deleted_activities` tables. Source of truth for BQ table structure.

- **Database**: Flyway migrations for PostgreSQL (Neon-hosted). Shared by `postgres-writer` and `api-gateway`.

- **Proto**: Protocol Buffer definitions for API contracts. `sports_metrics.proto` defines the response format for activity metrics; `user_config.proto` defines user settings stored in Firestore.

- **Sports**: JSON configuration mapping Strava sport types to app categories with their available metrics.
