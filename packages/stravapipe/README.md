# stravapipe

Strava data pipeline - processes webhook events and syncs to BigQuery and PostgreSQL.

## Services

This package provides two Cloud Run services:

| Service | Description | Trigger |
|---------|-------------|---------|
| `bq-inserter` | Syncs activities to BigQuery | Eventarc (PubSub) |
| `postgres-writer` | Syncs activities to PostgreSQL | Eventarc (PubSub) |

## Architecture

```
packages/stravapipe/
├── src/stravapipe/
│   ├── cloudrun/               # FastAPI apps for Cloud Run
│   │   ├── bq_inserter_app.py
│   │   ├── postgres_writer_app.py
│   │   └── pubsub.py           # CloudEvent parsing
│   ├── application/            # Business logic
│   │   ├── bq_inserter/        # BigQuery sync services
│   │   └── postgres_sync/      # PostgreSQL sync services
│   ├── adapters/               # External service clients
│   │   ├── strava/             # Strava API
│   │   ├── gcp/                # BigQuery, Cloud Storage
│   │   └── proto/              # Protobuf adapters (webhook)
│   ├── domain/                 # Domain models
│   ├── types/                  # Type definitions
│   │   └── generated/          # Protobuf generated code
│   ├── config/                 # Configuration
│   └── exceptions.py
├── tests/
├── Dockerfile.bq_inserter
└── Dockerfile.postgres_writer
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

## Deployment

Built and deployed via Pants:

```bash
# Build and publish Docker images
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish \
  packages/stravapipe:bq-inserter \
  packages/stravapipe:postgres-writer
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).

## Configuration

Each service has its own config class in `config/`:

- `BQInserterConfig` - GCP project, BigQuery dataset
- `PostgresWriterConfig` - GCP project, PostgreSQL connection string

All load from environment variables with Secret Manager integration for production. Strava API credentials are **not** needed by these services — the dispatcher enriches events with activity data before publishing to PubSub.

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
