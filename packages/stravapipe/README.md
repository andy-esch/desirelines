# stravapipe

Strava data pipeline - processes webhook events and syncs to BigQuery and PostgreSQL.

## Services

This package provides two Cloud Run services and one Cloud Run job:

| Service | Type | Description | Trigger |
|---------|------|-------------|---------|
| `bq-inserter` | Service | Syncs activities to BigQuery | Eventarc (PubSub) |
| `postgres-writer` | Service | Syncs activities to PostgreSQL | Eventarc (PubSub) |
| `backfill` | Job | Backfills historical activities to PG + BQ | Manual (`gcloud run jobs execute`) |

## Architecture

```
packages/stravapipe/
├── src/stravapipe/
│   ├── cloudrun/               # Cloud Run entrypoints
│   │   ├── bq_inserter_app.py  # FastAPI service
│   │   ├── postgres_writer_app.py  # FastAPI service
│   │   ├── backfill_job.py     # Batch job (runs to completion)
│   │   └── pubsub.py           # CloudEvent parsing
│   ├── application/            # Business logic
│   │   ├── backfill/           # Historical activity backfill
│   │   ├── bq_inserter/        # BigQuery sync services
│   │   └── postgres_sync/      # PostgreSQL sync services
│   ├── adapters/               # External service clients
│   │   ├── strava/             # Strava API
│   │   ├── firestore/          # Per-user token storage
│   │   ├── gcp/                # BigQuery, Cloud Storage
│   │   └── proto/              # Protobuf adapters (webhook)
│   ├── domain/                 # Domain models
│   ├── types/                  # Type definitions
│   │   └── generated/          # Protobuf generated code
│   ├── config/                 # Configuration
│   └── exceptions.py
├── tests/
└── Dockerfile                 # Mono-image for all services (CMD overridden per-service)
```

**Type Definitions:** Webhook and sports metrics types are defined in `schemas/proto/` and shared with Go services. Generated code lives in `types/generated/`. See `just proto-gen-backend`.

## Development

```bash
cd packages/stravapipe

# Install dependencies
uv sync

# Run tests
uv run pytest

# Type checking
uv run mypy src/

# Linting
uv run ruff check src/
```

### Local with docker-compose

```bash
# Start backend (includes all services + PubSub emulator)
docker compose --profile backend up

# View logs
docker compose logs -f postgres-writer
```

### Running the backfill job

The backfill job fetches historical Strava activities and writes them to PostgreSQL and BigQuery.

```bash
# Cloud Run (production)
gcloud run jobs execute desirelines-backfill \
  --set-env-vars ATHLETE_ID=12345,BACKFILL_YEARS=2023,2024,2025

# Local via docker-compose
ATHLETE_ID=12345 BACKFILL_YEARS=2024,2025 \
  docker compose --profile backfill run --rm backfill

# Local via Python (requires env vars or .env file)
ATHLETE_ID=12345 BACKFILL_YEARS=2024,2025 \
  GCP_PROJECT_ID=desirelines-dev \
  STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... \
  POSTGRES_CONNECTION_STRING="postgresql://..." \
  GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
    uv run python -m stravapipe.cloudrun.backfill_job
```

## Deployment

```bash
# Build the mono-image
docker build -t stravapipe .

# Run individual services with command overrides
docker run stravapipe uvicorn stravapipe.cloudrun.bq_inserter_app:app --host 0.0.0.0 --port 8080
docker run stravapipe uvicorn stravapipe.cloudrun.postgres_writer_app:app --host 0.0.0.0 --port 8080
docker run stravapipe python -m stravapipe.cloudrun.backfill_job
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).

## Configuration

Each service has its own config class in `config/`:

- `BQInserterConfig` - GCP project, BigQuery dataset
- `PostgresWriterConfig` - GCP project, PostgreSQL connection string
- `BackfillConfig` - Athlete ID, years, PG connection, Firestore database, Strava client creds

The event-driven services (bq-inserter, postgres-writer) load from environment variables with Secret Manager integration. Strava API credentials are **not** needed by these services — the dispatcher enriches events with activity data before publishing to PubSub.

The backfill job loads Strava client credentials from secret volume mounts and fetches per-user OAuth tokens from Firestore at runtime.

### PostgreSQL Connection Pooling

The postgres-writer auto-detects whether to use client-side pooling based on your database provider:

| Provider | Detection | Pooling |
|----------|-----------|---------|
| Neon (pooled) | `-pooler` in hostname | None (NullPool) |
| Neon (direct) | No `-pooler` | Client-side (QueuePool) |
| Self-hosted + PgBouncer | Manual config | None (NullPool) |
| Self-hosted direct | Manual config | Client-side (QueuePool) |

**Environment variables** (all optional):

```bash
# Strategy: "auto" (default), "external", or "internal"
POSTGRES_POOL_STRATEGY=auto

# Only used when strategy=internal:
POSTGRES_POOL_SIZE=2        # Base connections per instance
POSTGRES_MAX_OVERFLOW=3     # Burst capacity (5 total max)
```

**When to override:**

- Switching from Neon to Cloud SQL? Set `POSTGRES_POOL_STRATEGY=internal`
- Using PgBouncer in front of self-hosted? Set `POSTGRES_POOL_STRATEGY=external`
