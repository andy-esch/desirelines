# Cloud Functions

This directory contains the Cloud Functions (v2) that make up the Desirelines event processing pipeline. All functions are deployed as individual Cloud Run services via Cloud Functions v2.

## Overview

```
┌─────────────────┐
│ Strava Webhooks │
└────────┬────────┘
         │ HTTP POST
         ▼
┌─────────────────────────┐
│ activity_dispatcher     │  (Go)
│ Entry point for webhooks│
└────────┬────────────────┘
         │ Pub/Sub publish
         ▼
┌────────────────────────────────┐
│ desirelines_activity_events    │  (Pub/Sub Topic)
└────────┬─────────────┬─────────┘
         │             │
         ▼             ▼
┌────────────────┐  ┌─────────────────┐
│ bq_inserter    │  │ aggregator      │  (Python)
│ BigQuery sync  │  │ JSON summaries  │
└────────────────┘  └─────────────────┘
```

## Functions

### Python Functions (Event-Driven)

#### `bq_inserter.py`
**Purpose**: Syncs Strava activities to BigQuery

**Package**: `packages/stravapipe/`
- Uses: `stravapipe.application.bq_inserter` (use cases)
- Uses: `stravapipe.domain` (domain models)
- Uses: `stravapipe.config` (configuration)
- Uses: `stravapipe.cfutils` (Cloud Function utilities - CloudEvent processing, response helpers)

**Trigger**: Pub/Sub topic `desirelines_activity_events`

**Handles**:
- `create` events: Fetches activity from Strava API, inserts into `activities` table
- `delete` events: Archives activity to `deleted_activities` table, removes from `activities`

**Entry Point**: `main(event: CloudEvent)`

**Configuration**: Environment variables (see `stravapipe.config.load_bq_inserter_config()`)
- `GCP_PROJECT_ID`
- `GCP_BIGQUERY_DATASET`
- `STRAVA_SECRET_PATH` (volume mount)

---

#### `aggregator.py`
**Purpose**: Builds JSON summary documents for web UI consumption

**Package**: `packages/stravapipe/`
- Uses: `stravapipe.application.aggregator.usecases` (use cases)
- Uses: `stravapipe.domain` (domain models)
- Uses: `stravapipe.cfutils` (Cloud Function utilities - CloudEvent processing, response helpers)

**Trigger**: Pub/Sub topic `desirelines_activity_events`

**Handles**:
- `create` events: Updates yearly JSON summaries with new activity
- `delete` events: Removes activity from summaries, recalculates distances/pacing

**Entry Point**: `main(event: CloudEvent)`

**Outputs**: JSON files to Cloud Storage (`gs://desirelines-{env}-aggregations/`)
- `activity_summaries/{year}.json` - Day-by-day activity summaries
- `activity_summaries/distances_{year}.json` - Cumulative distance timeseries
- `activity_summaries/pacings_{year}.json` - Pacing timeseries

**Configuration**: Environment variables (see `stravapipe.config.load_aggregator_config()`)
- `GCP_PROJECT_ID`
- `GCP_STORAGE_BUCKET`
- `STRAVA_SECRET_PATH` (volume mount)

---

### Go Services (Cloud Run)

#### `dispatcher`
**Purpose**: Receives Strava webhook events, publishes to Pub/Sub

**Package**: `packages/dispatcher/`
**Deployment**: Cloud Run (Docker image)
**Dockerfile**: `packages/dispatcher/Dockerfile`

**Trigger**: HTTP (webhook endpoint)

**Flow**:
1. Validates webhook signature (Strava verification)
2. Parses webhook payload
3. Publishes to Pub/Sub topic `desirelines_activity_events`
4. Returns 200 OK to Strava

**Entry Point**: `cmd/local/main.go` (standalone HTTP server)

**Why Go**: Optimized for cold starts (~100ms vs ~1-2s for Python), low memory footprint

---

#### `apigateway`
**Purpose**: Serves activity data to web UI

**Package**: `packages/apigateway/`
**Deployment**: Cloud Run (Docker image)
**Dockerfile**: `packages/apigateway/Dockerfile`

**Trigger**: HTTP (REST API)

**Endpoints**:
- `GET /api/v1/activities/summary/{year}` - Activity summary for year
- `GET /api/v1/activities/distances/{year}` - Distance timeseries for year
- `GET /api/v1/activities/pacings/{year}` - Pacing timeseries for year
- `GET /health` - Health check

**Entry Point**: `cmd/local/main.go` (standalone HTTP server)

**Why Go**: Better performance for serving JSON payloads, simpler CORS handling

---

## Packaging and Dependencies

### Python Functions (Cloud Functions v2)
- **Dependencies**: Defined in `packages/stravapipe/pyproject.toml`
- **Build**: Pants packages functions as zip archives with pre-resolved dependencies
- **Deployment**: Cloud Functions v2 (source-based deployment)
- **Package Structure**:
  - `stravapipe/` - Core business logic (domain models, use cases, repositories, configuration)
  - `stravapipe/cfutils/` - Cloud Function infrastructure utilities (CloudEvent processing, response helpers, logging)

### Go Services (Cloud Run)
- **Dependencies**: Managed via `go.mod` in each package directory
- **Build**: Multi-stage Dockerfiles compile Go binaries (see `packages/*/Dockerfile`)
- **Deployment**: Cloud Run (Docker images pushed to Artifact Registry)
- **Shared Code**: Each service is self-contained in its package directory

---

## Deployment

### Python Functions (Cloud Functions v2)
```bash
# Package functions using Pants
pants package functions:aggregator functions:bq-inserter

# Deploy via Terraform
cd terraform/environments/dev
terraform apply
```
Pants creates zip archives with pre-resolved dependencies. Terraform deploys to Cloud Functions v2.

### Go Services (Cloud Run)
```bash
# Build and push Docker images
docker build -t us-central1-docker.pkg.dev/desirelines-dev/desirelines/dispatcher:latest packages/dispatcher
docker push us-central1-docker.pkg.dev/desirelines-dev/desirelines/dispatcher:latest

# Deploy via Terraform
cd terraform/environments/dev
terraform apply
```
Alternatively, use Pants to build Docker images: `pants package functions::dispatcher-image`

See `terraform/modules/desirelines/functions.tf` for infrastructure configuration.

---

## Common Patterns

### Error Handling
All functions follow consistent error handling:
- **Transient errors**: Re-raise exception → Cloud Functions retries (exponential backoff)
- **Permanent errors**: Log warning, return success → Message acknowledged, moves on
- **DLQ**: Failed messages after 5 retries go to `desirelines_dead_letter` topic

### Logging
Structured logging with correlation IDs:
```python
logger.info("Message", extra={"correlation_id": correlation_id, "activity_id": activity_id})
```

### Configuration
- **Secrets**: Mounted as volumes from Secret Manager (`/secrets/strava-auth`)
- **Environment Variables**: Set via Terraform
- **Dynamic Loading**: Secrets loaded on each invocation (not cached)

---

## Development

### Local Testing

**Python functions**:
```bash
# Install package in development mode
cd packages/stravapipe
uv sync

# Run tests
uv run pytest

# Test locally with docker-compose
docker compose --profile backend up
```

**Go services**:
```bash
# Test dispatcher
cd packages/dispatcher
go test ./...
go run cmd/local/main.go  # Starts local HTTP server on :8080

# Test apigateway
cd packages/apigateway
go test ./...
go run cmd/local/main.go  # Starts local HTTP server on :8080
```

**Full pipeline testing**:
```bash
# Start all backend services (PubSub emulator + all functions)
docker compose --profile backend up

# Or start frontend services (apigateway only)
docker compose --profile frontend up
```

### Deployment Flow
1. Make changes in `packages/`
2. Run tests
3. Package: `pants package functions::`
4. Deploy to dev: `cd terraform/environments/dev && terraform apply`
5. Test in dev environment
6. Deploy to prod: `cd terraform/environments/prod && terraform apply`

---

## Architecture Notes

### Why Separate Functions?
- **Separation of Concerns**: BigQuery sync vs. aggregation logic
- **Independent Scaling**: Functions scale independently based on load
- **Fault Isolation**: Failure in one doesn't affect the other
- **Performance**: Go for HTTP, Python for data processing

### Why Pub/Sub?
- **Decoupling**: Dispatcher doesn't know about downstream consumers
- **Reliability**: At-least-once delivery, dead letter queues
- **Scalability**: Cloud Functions auto-scale based on message rate
- **Debugging**: Messages preserved in dead letter queue for investigation

### Event Flow
```
Strava → Dispatcher → Pub/Sub → BQ Inserter (writes to BigQuery)
                             ↘→ Aggregator (writes to Cloud Storage)
```

Both consumers process the same event independently, allowing parallel execution.

---

## Troubleshooting

### Function Logs
```bash
# View logs for a function
gcloud functions logs read desirelines_bq_inserter --project=desirelines-dev --limit=50

# Filter for errors
gcloud functions logs read desirelines_aggregator --project=desirelines-dev | grep ERROR

# Follow logs in real-time
gcloud functions logs read desirelines_dispatcher --project=desirelines-dev --limit=50 --follow
```

### Dead Letter Queue
```bash
# Check for failed messages
gcloud pubsub subscriptions pull desirelines-bq-inserter-dlq --project=desirelines-dev --limit=5

# Monitor DLQ size
gcloud pubsub subscriptions describe desirelines-bq-inserter-dlq --project=desirelines-dev
```

### Common Issues
- **Function not triggering**: Check Pub/Sub subscription configuration
- **Slow cold starts**: Go functions should be fast; Python functions ~1-2s
- **Secret not found**: Verify secret mounted correctly in Terraform
- **BigQuery errors**: Check service account IAM permissions

---

## Related Documentation
- **Architecture**: `docs/architecture/`
- **Deployment Guide**: `docs/guides/bootstrap.md`
- **Package Structure**: `packages/stravapipe/README.md`
- **Terraform Config**: `terraform/modules/desirelines/functions.tf`
