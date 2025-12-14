# API Gateway (Go)

REST API serving aggregated activity data to the web frontend.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/activities` | List activities |
| GET | `/api/v1/summaries` | Get activity summaries |

## Data Sources

Configurable via `DATA_SOURCE` environment variable:

- `local-fixtures` - Local JSON files (default for dev)
- `cloud-storage` - GCS bucket (production)
- `postgres` - PostgreSQL database (when `ENABLE_DATABASE=true`)

## Environment Variables

```bash
# Required
PORT=8080

# Data source
DATA_SOURCE=local-fixtures              # or cloud-storage, postgres
LOCAL_FIXTURES_PATH=/app/data/fixtures  # for local-fixtures
GCP_BUCKET_NAME=desirelines-bucket      # for cloud-storage
ENABLE_DATABASE=false                   # enable postgres backend
POSTGRES_CONNECTION_STRING=postgres://...  # for postgres

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Development

### Local with docker-compose

```bash
# Start frontend services
docker compose --profile frontend up

# Test
curl http://localhost:8084/health
curl http://localhost:8084/api/v1/summaries
```

### Standalone

```bash
cd packages/apigateway
go run ./cmd/apigateway
```

### Tests

```bash
go test ./...
```

## Deployment

Built and deployed via Pants:

```bash
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish packages/apigateway:apigateway
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).
