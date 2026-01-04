# Docker Build Guide

Docker images for Desirelines services, built and published via Pants.

## Dockerfile Locations

```
packages/
├── dispatcher/
│   └── Dockerfile                  # Go - Cloud Run
├── apigateway/
│   └── Dockerfile                  # Go - Cloud Run
└── stravapipe/
    ├── Dockerfile.bq_inserter      # Python/FastAPI - Cloud Run
    └── Dockerfile.postgres_writer  # Python/FastAPI - Cloud Run

scripts/development/local-dev/
├── Dockerfile.cloudevent_adapter   # Python/FastAPI - local dev only
└── Dockerfile.firebase-emulators   # Firebase Auth + Firestore emulators
```

## Building with Pants (Recommended)

Pants is the recommended build system for CI/CD and production deployments.

### Build and Publish All Images

```bash
# Build and publish to Artifact Registry with git SHA tag
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish \
  packages/dispatcher:dispatcher \
  packages/apigateway:apigateway \
  packages/stravapipe:bq-inserter \
  packages/stravapipe:postgres-writer
```

Or use the Make target:

```bash
make build-publish
```

This:
- Builds all Docker images
- Tags with git SHA and `latest`
- Pushes to Artifact Registry

### Build Without Publishing

```bash
pants package packages/dispatcher:dispatcher
pants package packages/stravapipe:bq-inserter
```

### View Available Targets

```bash
pants list packages/stravapipe::
```

## Local Development with docker-compose

For local development, docker-compose builds images directly:

```bash
# Start backend services
docker compose --profile backend up

# Rebuild specific service
docker compose build dispatcher
```

### Profiles

- `backend` - Pipeline services (dispatcher, bq-inserter, postgres-writer, PubSub emulator)
- `frontend` - Web services (api-gateway, postgres, Firebase emulators)
- `debug` - Debugging tools (PubSub UI)

### Port Mappings

| Port | Service |
|------|---------|
| 8081 | Dispatcher |
| 8083 | BQ Inserter |
| 8084 | API Gateway |
| 8085 | PubSub Emulator |
| 8086 | PostgreSQL Writer |
| 8087 | CloudEvent Adapter |
| 8089 | Firestore Emulator |
| 9099 | Firebase Auth Emulator |
| 4000 | Firebase Emulator UI |
| 4200 | PubSub UI (debug) |
| 15430 | PostgreSQL |

## Build Strategies

### Go Services

Multi-stage build: `golang:1.25-alpine` → `alpine:latest` (~20MB final)

```dockerfile
FROM golang:1.25-alpine AS builder
# ... build binary ...

FROM alpine:latest
COPY --from=builder /app/main /app/main
CMD ["/app/main"]
```

### Python Services (Cloud Run)

Multi-stage build with uv for fast dependency installation:

```dockerfile
FROM python:3.13-slim AS builder
RUN pip install uv
# ... install deps with uv ...

FROM python:3.13-slim
# ... copy venv, run with uvicorn ...
```

## Related Documentation

- [Deployment Guide](./deployment.md) - Full deployment workflow
- [Local Testing](./local-testing.md) - Local development setup
- [Pants Documentation](https://www.pantsbuild.org/docs)
