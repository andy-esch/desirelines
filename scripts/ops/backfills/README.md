# Data Scripts

Scripts for backfilling and migrating production data.

## Script Index

| Script                                                           | Purpose                                                              | Status    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| [`backfill_bq_to_postgres.py`](#backfill-bigquery-to-postgresql) | Migrate activities from BigQuery → PostgreSQL                        | ✅ Active |
| [`backfill_routes_bq_to_postgres.py`](#backfill-routes)          | Backfill activity routes from BigQuery polylines → PostgreSQL        | ✅ Active |
| [`load_census_regions.py`](#load-census-regions)                 | Load US Census CBSA + county boundaries → `desirelines.regions`      | ✅ Active |
| [`backfill_route_regions.py`](#backfill-route-regions)           | Tag existing routes with the regions they cross → `activity_regions` | ✅ Active |
| [`webhook-replay/`](#webhook-replay-load-testing)                | Simulate production webhook load for testing                         | ✅ Active |

**Deprecated scripts** (in this directory but no longer maintained):

- `migrate_aggregations.py`, `migrate-to-multisport.sh`, `verify-migration.sh`, `cleanup-old-files.sh`, `rollback-migration.sh`, `backup-aggregations.sh` — Multi-sport migration (completed)

---

## Backfill BigQuery to PostgreSQL

**Script**: `backfill_bq_to_postgres.py`

One-time migration tool to populate PostgreSQL from existing BigQuery data. Useful after setting up PostgreSQL or recovering from data issues.

### Usage

```bash
# Set connection string (from Secret Manager or env)
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

# Dry run
uv run python scripts/ops/backfills/backfill_bq_to_postgres.py --dry-run

# Run backfill (defaults to desirelines-dev)
uv run python scripts/ops/backfills/backfill_bq_to_postgres.py

# Specify project
uv run python scripts/ops/backfills/backfill_bq_to_postgres.py --project desirelines-prod
```

### Requirements

- `POSTGRES_CONNECTION_STRING` environment variable
- BigQuery read permissions
- PostgreSQL write permissions

---

## Backfill Routes

**Script**: `backfill_routes_bq_to_postgres.py`

Backfills the `desirelines.activity_routes` table from BigQuery polyline data. Decodes Google encoded polylines to GeoJSON LineStrings and inserts via PostGIS `ST_GeomFromGeoJSON`. Uses `ON CONFLICT DO NOTHING` for safe re-runs.

Uses [uv inline script dependencies](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies) — no workspace setup needed.

### Usage

```bash
# Set connection string
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

# Dry run
uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py --dry-run

# Run backfill (defaults to desirelines-dev)
uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py

# Production
uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py --project desirelines-prod
```

### Requirements

- `POSTGRES_CONNECTION_STRING` environment variable
- BigQuery read permissions
- PostgreSQL with PostGIS extension (activity_routes table from V0003 migration)

---

## Load Census Regions

**Script**: `load_census_regions.py`

Populates the `desirelines.regions` boundary reference table (added in migration
`V0005`) that the routes-map feature spatial-joins activity routes against. Loads
two US Census cartographic boundary layers and classifies them into a CBSA →
county cascade:

- **CBSA** (`cb_<vintage>_us_cbsa_500k`) → `region_kind` `cbsa_metro` / `cbsa_micro`,
  split on the `LSAD` attribute (`M1` = metropolitan, `M2` = micropolitan; both
  ship in one file).
- **County** (`cb_<vintage>_us_county_500k`) → `region_kind` `county`, the
  fallback for the rural areas CBSAs don't cover.

Geometries are repaired and coerced to `MULTIPOLYGON` on insert
(`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(…)), 3))`). The
whole load runs in a single transaction, so `--replace` reloads are atomic.

This is the **US-only placeholder** dataset; `regions` is source-agnostic
(`source` + `region_kind` columns), so a global boundary dataset can be loaded
the same way later under new `source` values without a schema change.

Uses [uv inline script dependencies](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies)
(`pyshp` + `psycopg`) — no workspace setup needed.

### Usage

```bash
# Set connection string (admin/owner role — this writes the regions reference table)
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

# Dry run (download + parse, report metro/micro/county counts, insert nothing)
uv run scripts/ops/backfills/load_census_regions.py --dry-run

# Load (idempotent: ON CONFLICT DO NOTHING)
uv run scripts/ops/backfills/load_census_regions.py

# Clean reload of both layers (delete each source's rows first), or a newer vintage
uv run scripts/ops/backfills/load_census_regions.py --replace
uv run scripts/ops/backfills/load_census_regions.py --vintage 2023 --replace
```

### Requirements

- `POSTGRES_CONNECTION_STRING` (admin connection — the table is owned by the DDL
  role; the runtime app only reads `regions`)
- PostgreSQL with PostGIS and the `desirelines.regions` table (migration `V0005`)
- Network access to `www2.census.gov`

---

## Backfill Route Regions

**Script**: `backfill_route_regions.py`

Tags existing `desirelines.activity_routes` with the regions they cross, populating
`desirelines.activity_regions` for historical data (the postgres-writer does this
for new activities at ingestion). Set-based: for every non-virtual routed activity
it inserts a row per intersecting region (`ST_Intersects`), then an `earth` fallback
for routes that match no specific region. Idempotent (`ON CONFLICT DO NOTHING`);
`--replace` clears existing tags first.

Prerequisites: migrations V0005 + V0006, and `regions` populated via
`load_census_regions.py`.

### Usage

```bash
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

uv run scripts/ops/backfills/backfill_route_regions.py --dry-run
uv run scripts/ops/backfills/backfill_route_regions.py
uv run scripts/ops/backfills/backfill_route_regions.py --replace   # clears ALL tags first
```

### Requirements

- `POSTGRES_CONNECTION_STRING` (admin)
- `regions` table populated; `activities.trainer`/`manual` present (V0006)

---

## Webhook Replay (Load Testing)

**Directory**: `webhook-replay/`

Replays synthetic webhook events to simulate production load. Useful for:

- Load testing the webhook pipeline
- Validating infrastructure changes
- Stress testing before deployments

> **Note**: Not recommended for data backfill—uses 2x API calls per activity. Use Cloud Run Job `desirelines-backfill` for bulk backfill jobs.

### Usage

```bash
cd scripts/ops/backfills/webhook-replay
go build backfill_activities.go

# Run with rate limiting (0.2 req/sec = 1 per 5 seconds)
./backfill_activities -rate-limit 0.2
```

### How It Works

1. Reads activity IDs from BigQuery
2. Posts synthetic webhooks to Dispatcher
3. Full pipeline processes each activity (Dispatcher → PubSub → BQ Inserter → PostgreSQL Writer)

---

## Related Documentation

- [PubSub Subscription Design](../../docs/architecture/pubsub-subscription-design.md)
- [Bootstrap Guide](../../docs/guides/bootstrap.md)
- [Strava Adapters](../../packages/stravapipe/src/stravapipe/adapters/strava/_repositories.py)
