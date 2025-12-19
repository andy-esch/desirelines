# Data Scripts

Scripts for backfilling and migrating production data.

## Script Index

| Script                                                           | Purpose                                                       | Status                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| [`backfill_from_strava.py`](#backfill-from-strava)               | Backfill activities from Strava API → BigQuery + aggregations | ⚠️ Uses deprecated aggregator |
| [`backfill_bq_to_postgres.py`](#backfill-bigquery-to-postgresql) | Migrate activities from BigQuery → PostgreSQL                 | ✅ Active                     |
| [`webhook-replay/`](#webhook-replay-load-testing)                | Simulate production webhook load for testing                  | ✅ Active                     |

**Deprecated scripts** (in this directory but no longer maintained):

- `migrate_aggregations.py`, `migrate-to-multisport.sh`, `verify-migration.sh`, `cleanup-old-files.sh`, `rollback-migration.sh`, `backup-aggregations.sh` — Multi-sport migration (completed)

---

## Backfill from Strava

**Script**: `backfill_from_strava.py`

Fetches activities from Strava API and inserts into BigQuery, then generates Cloud Storage aggregations.

> ⚠️ **Deprecation Note**: This script currently writes aggregations via the aggregator pipeline, which has been deprecated in favor of PostgreSQL. A future refactor will update this to backfill the `postgres-writer` service instead.

### Usage

```bash
# Preview (recommended first)
uv run python scripts/data/backfill_from_strava.py --years 2024 --dry-run

# Backfill single year
uv run python scripts/data/backfill_from_strava.py --years 2024

# Multiple years
uv run python scripts/data/backfill_from_strava.py --years 2023 2024 2025

# Verbose logging
uv run python scripts/data/backfill_from_strava.py --years 2024 --verbose
```

### Requirements

- Strava API credentials in Secret Manager
- BigQuery, Cloud Storage, Firestore write permissions

### Rate Limits

Strava allows 100 requests/15min, 1000/day. With 100 activities per request, you can fetch ~20,000 activities/day.

---

## Backfill BigQuery to PostgreSQL

**Script**: `backfill_bq_to_postgres.py`

One-time migration tool to populate PostgreSQL from existing BigQuery data. Useful after setting up PostgreSQL or recovering from data issues.

### Usage

```bash
# Set connection string (from Secret Manager or env)
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

# Dry run
uv run python scripts/data/backfill_bq_to_postgres.py --dry-run

# Run backfill (defaults to desirelines-dev)
uv run python scripts/data/backfill_bq_to_postgres.py

# Specify project
uv run python scripts/data/backfill_bq_to_postgres.py --project desirelines-prod
```

### Requirements

- `POSTGRES_CONNECTION_STRING` environment variable
- BigQuery read permissions
- PostgreSQL write permissions

---

## Webhook Replay (Load Testing)

**Directory**: `webhook-replay/`

Replays synthetic webhook events to simulate production load. Useful for:

- Load testing the webhook pipeline
- Validating infrastructure changes
- Stress testing before deployments

> **Note**: Not recommended for data backfill—uses 2x API calls per activity. Use `backfill_from_strava.py` for actual data recovery.

### Usage

```bash
cd scripts/data/webhook-replay
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
