# stravapipe

Strava data pipeline - fetch, process, and store Strava webhook events.

## Overview

`stravapipe` is a unified package that handles all Strava webhook processing for the desirelines project. It provides shared infrastructure for:

- **BigQuery Inserter**: Syncs Strava activities to BigQuery for storage and analysis
- **Aggregator**: Generates daily/cumulative activity summaries stored in Cloud Storage

## Architecture

The package is organized into:

### Shared Components

- **`domain/`** - Domain models (WebhookRequest, AspectType, StravaActivity)
- **`exceptions.py`** - Custom exceptions (ActivityNotFoundError, etc.)
- **`adapters/`** - External service adapters
  - `strava/` - Strava API client
  - `gcp/` - Google Cloud Platform adapters (BigQuery, Cloud Storage)

### Application Logic (by function)

- **`application/bq_inserter/`** - BigQuery inserter-specific services
  - `sync_service.py` - Create/update activities
  - `delete_service.py` - Archive deleted activities

- **`application/aggregator/`** - Aggregator-specific use cases
  - `update_summary.py` - Create/update daily summaries
  - `delete_summary.py` - Remove activities from summaries

- **`application/shared/`** - Shared services
  - `pacing_service.py` - Cumulative distance calculations
  - `export_service.py` - Export summaries to Cloud Storage

### Configuration

- **`config/`** - Function-specific configuration
  - `bq_inserter.py` - BQ inserter config
  - `aggregator.py` - Aggregator config
  - `common.py` - Shared config (GCP project, region, etc.)

## Development

```bash
# Install dependencies
cd packages/stravapipe
uv sync

# Run tests
uv run pytest

# Type checking
uv run mypy src/
```

## Usage

This package is used by two Cloud Functions:

- `functions/activity_bq_inserter.py` - Uses `application.bq_inserter`
- `functions/activity_aggregator.py` - Uses `application.aggregator`

Both functions share the same domain models, adapters, and configuration patterns.
