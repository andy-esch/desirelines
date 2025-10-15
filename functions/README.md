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

#### `activity_bq_inserter.py`
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

#### `activity_aggregator.py`
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

### Go Functions (HTTP Handlers)

#### `activity_dispatcher/`
**Purpose**: Receives Strava webhook events, publishes to Pub/Sub

**Package**: `packages/dispatcher/`
- Thin wrapper that calls `dispatcher.NewHandler()`

**Trigger**: HTTP (webhook endpoint)

**Flow**:
1. Validates webhook signature (Strava verification)
2. Parses webhook payload
3. Publishes to Pub/Sub topic `desirelines_activity_events`
4. Returns 200 OK to Strava

**Entry Point**: `ActivityDispatcher(w http.ResponseWriter, r *http.Request)`

**Why Go**: Optimized for cold starts (~100ms vs ~1-2s for Python), low memory footprint

---

#### `apigateway/`
**Purpose**: Serves activity data to web UI

**Package**: `packages/apigateway/`
- Thin wrapper that calls `apigateway.NewHandler()`

**Trigger**: HTTP (REST API)

**Endpoints**:
- `GET /api/v1/activities/summary/{year}` - Activity summary for year
- `GET /api/v1/activities/distances/{year}` - Distance timeseries for year
- `GET /api/v1/activities/pacings/{year}` - Pacing timeseries for year
- `GET /health` - Health check

**Entry Point**: `APIGateway(w http.ResponseWriter, r *http.Request)`

**Why Go**: Better performance for serving JSON payloads, simpler CORS handling

---

## Packaging and Dependencies

### Python Functions
- **Requirements**: Generated from `packages/stravapipe/pyproject.toml`
  - `requirements.txt` (for both aggregator and bq_inserter)
- **Build**: Packaging script (`scripts/operations/package-functions.sh`) copies stravapipe package into deployment archives
- **Package Structure**:
  - `stravapipe/` - Core business logic (domain models, use cases, repositories, configuration)
  - `stravapipe/cfutils/` - Cloud Function infrastructure utilities (CloudEvent processing, response helpers, logging)

### Go Functions
- **Dependencies**: Managed via `go.mod` in each function directory
- **Build**: Dockerfiles compile Go binaries from packages
- **Shared Code**: Both Go functions import from `packages/dispatcher/` and `packages/apigateway/`

---

## Deployment

### Packaging
```bash
./scripts/package-functions.sh
```
Creates deployment archives for all functions:
- `aggregator-{git-sha}.zip`
- `bq-inserter-{git-sha}.zip`
- `dispatcher-{git-sha}.zip`
- `api-gateway-{git-sha}.zip`

### Terraform Deployment
```bash
cd terraform/environments/dev
terraform apply
```
Deploys all functions from packaged archives. See `terraform/modules/desirelines/functions.tf`.

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

# Test function locally (requires emulators)
cd functions
python -c "from activity_aggregator import main; main(test_event)"
```

**Go functions**:
```bash
cd functions/activity_dispatcher
go test ./...
go run main.go  # Starts local HTTP server
```

### Deployment Flow
1. Make changes in `packages/`
2. Run tests
3. Package functions: `./scripts/package-functions.sh`
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
