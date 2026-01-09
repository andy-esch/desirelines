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
│   │   ├── postgres_sync/      # PostgreSQL sync services
│   │   └── aggregator/         # Summary generation
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

**Type Definitions:** Webhook and sports metrics types are defined in `schemas/proto/` and shared with Go services. Generated code lives in `types/generated/`. See `make proto-gen-backend`.

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

- `BQInserterConfig` - BigQuery dataset, Strava credentials
- `PostgresWriterConfig` - Connection string, Strava credentials

All load from environment variables with Secret Manager integration for production.
