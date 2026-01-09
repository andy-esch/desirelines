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
./scripts/development/local-dev/setup-local-environment.sh

# Or manually:
uv sync
cd packages/dispatcher && go mod download
cp .env.example .env
```

### Prerequisites

- [`uv`](https://docs.astral.sh/uv/) - Python package manager
- [Go 1.25+](https://go.dev/)
- [Pants](https://www.pantsbuild.org/) - Build system
- Docker, Terraform, Google Cloud SDK

## Development

```bash
make start-backend   # Backend pipeline with PubSub emulator
make start-frontend  # Frontend + API gateway + Postgres
make test            # Run all tests
make lint            # Lint all code
```

## Architecture

```
packages/
├── web/           # React frontend
├── apigateway/    # Go REST API
├── dispatcher/    # Go webhook receiver
└── stravapipe/    # Python event processors (bq-inserter, postgres-writer)

schemas/
├── proto/         # Cross-language type definitions
├── database/      # PostgreSQL migrations
└── bigquery/      # BigQuery table schemas
```

**Data Flow**: Strava webhook → dispatcher → PubSub → stravapipe → PostgreSQL/BigQuery → apigateway → web

## Documentation

- [**Bootstrap Guide**](./docs/guides/bootstrap.md) - Complete environment setup
- [**Strava Webhook**](./docs/guides/strava-webhook.md) - OAuth2 + webhook configuration (required!)
- [**Deployment Guide**](./docs/guides/deployment.md) - Cloud deployment
- [**All Guides**](./docs/guides/README.md)

## Contributing

This project is in active development. Contributions welcome!
