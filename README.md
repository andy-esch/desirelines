<div align="center">
  <img src="assets/desirelines.svg" alt="Desire Lines" width="120" height="120">
  <h1>Desire Lines</h1>
  <p><em>Your fitness goals made visible</em></p>
</div>

A web app that transforms your Strava data into visual progress tracking. Set annual goals, watch your cumulative progress climb against your target "desire line."

## Features

- **Goal Visualization** - Set distance targets, track progress in real-time
- **Strava Integration** - Automatic activity import via webhooks
- **Multi-Sport Support** - Cycling, running, yoga, and more
- **Modern Stack** - React frontend, Go/Python backend, Google Cloud Run

## Quick Start

```bash
# Complete local setup
./scripts/ops/setup/setup-local.sh

# Or manually:
uv sync
cd packages/dispatcher && go mod download
just setup-secrets
```

### Prerequisites

- [`uv`](https://docs.astral.sh/uv/) - Python package manager
- [Go](https://go.dev/) (version in `go.mod`)
- [Pants](https://www.pantsbuild.org/) - Build system
- [just](https://github.com/casey/just) - Task runner
- Docker, Terraform, Google Cloud SDK

## Development

We use [`just`](https://github.com/casey/just) as our task runner. Commands default to fast native tools (`uv`, `go`, `npm`) but can optionally use Pants.

```bash
just test            # Run all tests (native tools)
just lint            # Lint all code (native tools)
just web-dev         # Start web dev server
just --list          # List all available commands

# Use Pants for specific commands
just py-test --pants
just go-test --pants
```

For full environment orchestration (Docker):

```bash
just start-backend   # Backend pipeline with PubSub emulator
just start-frontend  # Frontend + API gateway + Postgres
```

## Architecture

```
packages/
├── web/           # React frontend
├── apigateway/    # Go REST API
├── dispatcher/    # Go webhook receiver
├── stravapipe/    # Python event processors (bq-inserter, postgres-writer, deletion-service)
└── shared/        # Go shared library (logging, OTel, rate limiting)

schemas/
├── proto/         # Cross-language type definitions
├── database/      # PostgreSQL migrations
└── bigquery/      # BigQuery table schemas
```

See [**packages/README.md**](./packages/README.md) for detailed descriptions and a data flow diagram.

**Data Flow**:

- Activities: Strava webhook → dispatcher → Pub/Sub → bq-inserter + postgres-writer → BigQuery/PostgreSQL → apigateway → web
- Deauth: Strava webhook → dispatcher → Pub/Sub → deletion-service → deletes from PostgreSQL, BigQuery, Firestore

## Documentation

- [**Bootstrap Guide**](./docs/guides/bootstrap.md) - Complete environment setup
- [**Strava Webhook**](./docs/guides/strava-webhook.md) - OAuth2 + webhook configuration (required!)
- [**Deployment Guide**](./docs/guides/deployment.md) - Cloud deployment
- [**All Guides**](./docs/guides/README.md)
- [**Project Improvements**](./docs/improvements/README.md) - Prioritized proposals to raise the bar

## Contributing

This project is in active development. Contributions welcome!
