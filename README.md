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
./scripts/local-dev/setup-local-environment.sh

# Or manually:
uv sync
cd packages/dispatcher && go mod download
cp .env.example .env  # Edit with your values
```

## Strava Webhook Setup ⭐ CRITICAL

**Important**: Strava webhooks require OAuth2 user authorization to deliver events. See [`docs/strava-webhook-setup.md`](./docs/strava-webhook-setup.md) for complete setup guide.

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

### Cloud Development

```bash
# Package functions with current git SHA (required for deployment)
make package-functions

# Deploy to dev environment with SHA-tagged functions
cd terraform/environments/dev
terraform apply -var="function_source_tag=$(git rev-parse --short HEAD)"

# Test with real Strava webhooks
# (requires OAuth2 authorization as described above)
```

For comprehensive setup instructions, see [`docs/strava-webhook-setup.md`](./docs/strava-webhook-setup.md).

### Testing

Run tests with

```bash
$ make test
```

## Architecture

- **Frontend**: React web application (`web/`)
- **Backend**: Serverless Google Cloud Functions (`functions/`)
- **Data**: BigQuery for analytics storage
- **Integration**: Strava API webhooks for real-time activity updates
- **Infrastructure**: Terraform for cloud resource management

## Documentation

### Essential Guides

- **[Complete Setup Guide](./docs/setup-guide.md)** - Comprehensive development setup (recommended)
- **[Strava Webhook Setup](./docs/strava-webhook-setup.md)** - OAuth2 and webhook configuration
- **[Local Development Scripts](./scripts/local-dev/README.md)** - Script organization and usage

### Project Reference

- **[Frontend Development](./docs/frontend-development.md)** - React app development guide

## Contributing

This project is in active development. Contributions, suggestions, and feedback are welcome!
