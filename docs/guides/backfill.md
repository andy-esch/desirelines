# Activity Data Backfill Guide

## Purpose

Backfill historical Strava activity data from old system (`progressor-x`) into new environments by replaying webhook events through the full pipeline.

**Use cases:**
- **Production backfill**: Restore historical activities (new prod deployed Sept 2025, only has data since then)
- **Dev fixtures**: Generate small test datasets for web app iteration
- **Local testing**: Export activity data as JSON fixtures

## Strategy: Webhook Replay

Posts synthetic webhook events to dispatcher → exercises full pipeline → populates both BigQuery and Cloud Storage.

**Why not direct data copy?**
- Validates current code handles historical data
- Re-runnable if aggregation logic changes
- Single script for prod backfill + fixture generation

## Script Location

```
scripts/data/backfill_activities.go
```

**Language**: Go (learning opportunity, BigQuery client, HTTP patterns)

## Architecture

```
1. Query Phase    → LEFT JOIN old BQ vs new BQ → missing activity IDs
2. Fetch Phase    → Pull activity details from old BQ (avoid Strava API)
3. Transform Phase→ Convert BQ row → Strava webhook event format
4. Replay Phase   → POST to dispatcher (sequential, rate-limited)
5. Export Phase   → Optional: save as JSON fixture file
```

## Usage Examples

### Production Backfill
```bash
# Backfill missing 2024 activities to prod
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=prod \
  --start-date=2024-01-01 \
  --end-date=2024-12-31

# Dry run preview
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=prod \
  --start-date=2024-01-01 \
  --end-date=2024-12-31 \
  --dry-run
```

### Dev Fixtures
```bash
# Small subset for dev testing
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=dev \
  --start-date=2024-01-01 \
  --end-date=2024-01-31 \
  --limit=50
```

### Local Fixtures
```bash
# Export JSON file for local Docker Compose
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --export-fixtures=fixtures/activities_2024_sample.json \
  --limit=20
```

## Script Options

**Required:**
- `--source-project`: Source GCP project (e.g., `progressor-x`)
- `--target-env`: Target environment (`prod`, `dev`, `local`) OR `--export-fixtures`

**Date filtering:**
- `--start-date`: Start date (YYYY-MM-DD)
- `--end-date`: End date (YYYY-MM-DD)

**Limiting:**
- `--limit`: Max activities to process
- `--activity-type`: Filter by type (Run, Ride, etc.)

**Control:**
- `--dry-run`: Preview without executing
- `--rate-limit`: Requests/second (default: 2)
- `--verbose`: Detailed logging

**Export:**
- `--export-fixtures`: Export to JSON file instead of posting

## Implementation Notes

### Rate Limiting
- Default: 2 req/s (avoid aggregator race conditions on bucket writes)
- Sequential processing (no goroutine parallelism)

### Strava Webhook Format
```json
{
  "object_type": "activity",
  "object_id": 123456789,
  "aspect_type": "create",
  "owner_id": 987654321,
  "subscription_id": 12345,
  "event_time": 1234567890
}
```

### Error Handling
- Continue on individual failures, log errors
- Checkpoint file for resume capability
- Retry logic with backoff

## Testing Phases

**Phase 1: Dev (10 activities)**
```bash
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=dev \
  --limit=10 \
  --verbose
```
Validate: BQ rows, Cloud Storage summaries, logs

**Phase 2: Dev (1 month)**
```bash
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=dev \
  --start-date=2024-01-01 \
  --end-date=2024-01-31
```
Validate: Date filtering, aggregation logic

**Phase 3: Prod (full year)**
```bash
go run scripts/data/backfill_activities.go \
  --source-project=progressor-x \
  --target-env=prod \
  --start-date=2024-01-01 \
  --end-date=2024-12-31
```
Monitor: Cloud Function logs, dead letter queue

## Scripts Directory Organization

### Proposed Structure
```
scripts/
├── infrastructure/     # Deployment, environment setup
│   ├── bootstrap-environment.sh
│   ├── bootstrap-terraform-sa.sh
│   └── deploy-secrets.sh
├── development/        # Local dev tooling
│   ├── setup-local-testing.sh
│   ├── api-gateway-tunnel.sh
│   └── local-dev/      # Docker compose helpers
├── data/              # Data operations
│   └── backfill_activities.go
└── operations/        # Operational tasks
    ├── package-functions.sh
    └── webhook-management.sh
```

### Migration Plan
- Move existing scripts into subdirectories
- Update documentation references
- Add README in each subdirectory

## Related Documentation

- [Project Master Plan](./project-master-plan.md)
- [Bootstrap Guide](./bootstrap-guide.md)
- [Local Testing Setup](./local-testing-setup.md)
