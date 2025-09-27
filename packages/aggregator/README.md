# Activity Aggregator

Processes Strava activity events from PubSub and generates aggregated fitness summaries stored in Cloud Storage. This Python package provides the core aggregation logic for the desirelines fitness data pipeline.

## Architecture

**Package Structure:**
```
packages/aggregator/      # Python package with aggregation logic
├── src/aggregator/       # Main package code
│   ├── config.py         # Pydantic configuration management
│   ├── strava/           # Strava API client and data models
│   └── aggregation/      # Activity aggregation logic
└── tests/                # Unit tests

functions/activity_aggregator.py  # Cloud Function thin wrapper
```

**Deployment Model:**
This Python package is imported by the Cloud Function wrapper at `functions/activity_aggregator.py`, following the thin wrapper pattern used throughout the project.

## Features

- **PubSub event processing** - Receives activity events from the dispatcher
- **Strava API integration** - Fetches full activity details using mounted secrets
- **Aggregation logic** - Generates aggregated cumulative distance summaries by year
- **Cloud Storage output** - Stores aggregated data as JSON files

## Environment Variables

The aggregator reads configuration from environment variables and secret volumes:

```bash
# GCP Configuration
GCP_PROJECT_ID=your-project-id
GCP_BUCKET_NAME=your-bucket-name

# Optional Configuration
LOG_LEVEL=INFO  # Default: INFO
ENVIRONMENT=dev # dev/prod
```

**Secrets:** Strava API credentials are mounted at `/etc/secrets/strava_auth.json`. See `strava-auth-local.json.example` in the project root for the expected JSON structure.

## Development

### Prerequisites
- Python 3.13+
- uv package manager
- Google Cloud credentials configured

### Local Development

```bash
cd packages/aggregator
uv sync

# Run tests
uv run pytest

# Run linting
uv run ruff check
uv run ruff format
```

### Testing with Docker Compose

The aggregator runs as part of the complete pipeline in docker-compose:

```bash
# From project root
docker compose up activity-aggregator
```

This connects to the PubSub emulator and processes events from the dispatcher.

## Cloud Function Integration

This package is used by the Cloud Function wrapper at `functions/activity_aggregator.py`, which follows the established thin wrapper pattern for consistent architecture across all functions.
