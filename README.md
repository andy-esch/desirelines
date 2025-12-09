<div align="center">
  <img src="assets/desirelines.png" alt="Desire Lines" width="120" height="120">
  <h1>Desire Lines</h1>
  <p><em>Your fitness goals made visible</em></p>
</div>

Desire Lines is a web application that transforms your Strava fitness data into visual progress tracking against your personal goals. The name draws from the transportation planning concept of "desire lines" &emdash; the natural pathways people create for efficiency and convenience instead of following prescribed routes. In this app, your **desire lines** represent your distance and pacing goals: set a target like riding 4,000 miles this year, and visualize your cumulative progress alongside the straight "desire line" showing your ideal trajectory.

**🎯 Turn abstract goals into concrete visual progress**

## Project History Note

This repository represents the current working state of a personal project that is being prepared for full open source release. The original development history will be made available once the transition is complete.

## Features

- **Goal Visualization**: Set annual distance or activity targets and track progress in real-time
- **Strava Integration**: Automatic activity import via webhooks (no manual uploads!)
- **Modern Web Interface**: Clean, responsive dashboard for progress tracking (WIP ;))
- **Serverless Architecture**: Built on Google Cloud Functions for reliable, scalable data processing

## Quick Start

This monorepo system processes Strava activity events through a serverless pipeline and presents aggregated data via a React web interface.

### Prerequisites

- **uv** (Python package manager): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Go 1.25+**: For dispatcher development
- **Docker**: For local development environment
- **Google Cloud SDK**: For deployment
- **Terraform**: For infrastructure management
- **Strava Developer Account**: For API access

### Installation

```bash
# Complete local development setup (recommended)
./scripts/development/local-dev/setup-local-environment.sh

# Or manually:
uv sync
cd packages/dispatcher && go mod download
cp .env.example .env  # Edit with your values
```

## Strava Webhook Setup ⭐ CRITICAL

**Important**: Strava webhooks require OAuth2 user authorization to deliver events. See [`docs/guides/strava-webhook.md`](./docs/guides/strava-webhook.md) for complete setup guide.

### Quick Webhook Setup

1. **Create Strava API application** at https://www.strava.com/settings/api
2. **Complete OAuth2 authorization** (critical step often missed!)
3. **Deploy secrets**: `make deploy-secrets dev SECRET_FILE=strava-auth-dev.json`
4. **Create webhook**: `make create-webhook dev`

**Without OAuth2 authorization, webhook subscriptions will be created successfully but no events will be delivered.**

## Development

### Local Development

```bash
# Pure local (PubSub emulator, no GCP)
make start

# Hybrid local (real BigQuery/Storage + PubSub emulator)
make start-local

# Test the pipeline
make test-full-flow

# View logs
make logs
```

### Cloud Deployment

```bash
# Build and push Cloud Run images
make build-push-images

# Package Python Cloud Functions
./scripts/operations/package-functions.sh

# Deploy to dev environment
cd terraform/environments/dev
terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"

# Setup Strava webhook
make create-webhook
```

See [Deployment Guide](./docs/guides/deployment.md) for complete instructions.

### Testing

Run tests with

```bash
$ make test
```

## Build System

This project uses [Pants](https://www.pantsbuild.org/) for build orchestration across Python, Go, and TypeScript.

### Quick Commands

```bash
# Run all tests
pants test ::

# Run tests for specific package
pants test packages/stravapipe::

# Lint all code
pants lint ::

# Format all code
pants fmt ::

# Type check
pants check ::

# Test only what changed
pants --changed-since=main test
```

**Note:** Pants is currently being integrated. Some features (like Cloud Function packaging) will be available in later phases.

## Architecture

- **Frontend**: React web application (`packages/web/`)
- **Backend**:
  - Cloud Run: Go services for HTTP endpoints (dispatcher, api-gateway)
  - Cloud Functions: Python services for event processing (bq-inserter, aggregator)
- **Data**: BigQuery for analytics storage, Cloud Storage for aggregations
- **Integration**: Strava API webhooks for real-time activity updates
- **Infrastructure**: Terraform for cloud resource management

See [Architecture Documentation](./docs/architecture/) for detailed design.

## Documentation

### Essential Guides

- **[Bootstrap Guide](./docs/guides/bootstrap.md)** - Complete environment setup (dev/prod)
- **[Deployment Guide](./docs/guides/deployment.md)** - Cloud deployment procedures
- **[Strava Webhook Setup](./docs/guides/strava-webhook.md)** - OAuth2 and webhook configuration
- **[Local Development Scripts](./scripts/development/local-dev/README.md)** - Script organization and usage

### Project Reference

- **[Docker Architecture](./docs/DOCKER.md)** - Docker build setup and container management
- **[Frontend Development](./docs/guides/frontend-local-dev.md)** - React app development guide
- **[Local Testing](./docs/guides/local-testing.md)** - Testing the full pipeline locally

## Contributing

This project is in active development. Contributions, suggestions, and feedback are welcome!
