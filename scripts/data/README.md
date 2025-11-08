# Data Scripts

This directory contains scripts for managing production data, specifically for backfilling historical Strava activities.

## Backfill Scripts

We maintain two backfill approaches for different use cases:

### 1. Python Strava API Backfill (Recommended for Production)

**Script**: `backfill_from_strava.py`

**Purpose**: Efficiently backfill production data using Strava API as the source of truth.

**How it works**:
1. Fetches activities directly from Strava API (100 activities per request)
2. Inserts activities to BigQuery (skips duplicates gracefully)
3. Generates aggregation files (distance, pacing data) for Cloud Storage

**Advantages**:
- ✅ **Single API call per 100 activities** (vs. 2x calls in webhook replay)
- ✅ **Strava as source of truth** - excludes deleted activities
- ✅ **Efficient rate limit usage** - 100 requests/15min = ~20,000 activities/day
- ✅ **Handles duplicates** - safe to re-run for same year
- ✅ **Batch aggregation** - uses `UpdateSummaryUseCase.run_batch()` for efficiency
- ✅ **Sport type filtering** - processes only cycling activities (Ride/VirtualRide)

**Rate Limits**:
- Strava: 100 requests/15 minutes, 1000 requests/day
- With 100 activities per page: Can fetch ~20,000 activities per day
- Estimated total activities: 1,000-5,000 (fits within daily limit)

**Usage**:
```bash
# Preview activities without inserting (recommended first step)
python scripts/data/backfill_from_strava.py --years 2024 --dry-run

# Backfill single year
python scripts/data/backfill_from_strava.py --years 2024

# Backfill multiple years
python scripts/data/backfill_from_strava.py --years 2023 2024 2025

# Verbose logging for debugging
python scripts/data/backfill_from_strava.py --years 2024 --verbose
```

**Requirements**:
- Strava API credentials configured in Secret Manager
- BigQuery write permissions
- Cloud Storage write permissions
- Firestore write permissions (for aggregations)

**Important Notes**:
- ⚠️ **Currently processes cycling activities only** (Ride and VirtualRide types)
- If you add support for other sports (running, swimming, yoga), you must:
  1. Update aggregator pipeline to process new sport types
  2. Update `backfill_from_strava.py` line 216 to include new types
  3. Re-run backfill for affected years
- See task: `docs/planning/tasks/ready-to-start/multi-sport-aggregation.md`

**When to use**:
- Initial production data backfill
- Recovering from data issues
- Migrating between environments
- Ensuring Strava data is source of truth
- Re-generating aggregations after adding new sport types

---

### 2. Go Webhook Replay (Legacy - Pipeline Validation Only)

**Script**: `webhook-replay/backfill_activities.go`

**Purpose**: Validate the full webhook processing pipeline by replaying synthetic webhook events.

**How it works**:
1. Reads activity IDs from source BigQuery table
2. Posts synthetic webhook payloads to Dispatcher
3. Dispatcher fetches activity from Strava API (1st API call)
4. BQ Inserter fetches same activity from Strava API (2nd API call)
5. Full pipeline processes each activity

**Disadvantages**:
- ❌ **2x API calls per activity** - hits rate limits quickly
- ❌ **Slow** - processes activities one at a time
- ❌ **Rate limited** - only ~200-300 activities/day practical limit
- ❌ **Old BigQuery data** - may include deleted activities

**Advantages**:
- ✅ **Full pipeline validation** - tests entire webhook flow
- ✅ **Realistic simulation** - mimics actual Strava webhook behavior

**Usage**:
```bash
# Build
cd scripts/data/webhook-replay
go build backfill_activities.go

# Run with rate limiting
./backfill_activities -rate-limit 0.2  # 0.2 requests/sec = 1 per 5 seconds

# Process specific year range (requires code modification)
# Edit constants in backfill_activities.go
```

**When to use**:
- Testing webhook pipeline end-to-end
- Validating infrastructure changes
- Debugging webhook processing issues
- NOT recommended for production data backfill

---

## Choosing the Right Approach

| Scenario | Recommended Script |
|----------|-------------------|
| **Production data backfill** | `backfill_from_strava.py` |
| **Recovering from data loss** | `backfill_from_strava.py` |
| **Testing webhook pipeline** | `backfill_activities.go` |
| **Validating infrastructure** | `backfill_activities.go` |
| **Handling deleted activities** | `backfill_from_strava.py` |

## Architecture Overview

### Python Backfill Architecture

```
Strava API (Source of Truth)
    ↓ (fetch 100 activities per request)
DetailedStravaActivitiesRepo.read_activities_by_year()
    ↓
InsertActivity Use Case
    ↓
BigQuery: desirelines.activities
    ↓
UpdateSummaryUseCase.run_batch()
    ↓
Cloud Storage: distance/pacing data
```

### Go Webhook Replay Architecture

```
Old BigQuery Snapshot
    ↓ (read activity IDs)
Synthetic Webhook POST
    ↓
Cloud Function: Dispatcher
    ↓ (fetch activity from Strava - 1st call)
PubSub: bq-inserter-topic
    ↓
Cloud Function: BQ Inserter
    ↓ (fetch activity from Strava - 2nd call)
BigQuery: desirelines.activities
    ↓
PubSub: aggregator-topic
    ↓
Cloud Function: Aggregator
    ↓
Cloud Storage: distance/pacing data
```

## Related Documentation

- **Strava API**: `packages/stravapipe/src/stravapipe/adapters/strava/_repositories.py`
- **BigQuery Inserter**: `packages/stravapipe/src/stravapipe/application/bq_inserter/`
- **Aggregator**: `packages/stravapipe/src/stravapipe/application/aggregator/`
- **Task Planning**: `docs/planning/tasks/ready-to-start/production-data-backfill.md`
- **Original Backfill Docs**: `docs/planning/archive/backfill.md`

## Troubleshooting

### Rate Limit Errors

If you hit Strava rate limits:
```
Error: Rate limit exceeded (429)
```

**Solution**:
- Wait 15 minutes for rate limit window to reset
- Reduce `per_page` parameter (currently 100, minimum 30)
- Process fewer years per run
- Schedule backfill during off-peak hours

### Duplicate Activity Errors

The Python script handles duplicates gracefully:
```python
# Skips without error
if "already exists" in error_msg or "duplicate" in error_msg:
    skipped_count += 1
```

**Safe to re-run** the same year multiple times.

### Missing Aggregation Files

If aggregations fail to generate:
1. Check Cloud Storage write permissions
2. Verify Firestore write permissions
3. Check logs: `gcloud logging read "resource.type=cloud_function"`
4. Re-run for specific year: `--years 2024`

---

## Multi-Sport Migration Scripts

Scripts for migrating existing cycling-only data to multi-sport format.

### Migration Overview

**Purpose**: Migrate from flat file structure (`activities/2024.json`) to sport-specific structure (`activities/2024/metrics/cycling.json`).

**Key Changes**:
- Converts miles to meters (Strava standard)
- Separates data by sport (cycling, running, yoga)
- Adds metadata files with sport totals
- Creates both metrics (pre-computed) and source (raw) files

**Storage Structure**:
```
BEFORE (current cycling-only format):
  activities/
    2024/
      distances.json           # Cycling data, miles
      pacings.json
      summary_activities.json
    2023/
      distances.json
      ...

AFTER (multi-sport format):
  activities/
    2024/
      metadata.json            # NEW - year summary, sport totals
      metrics/                 # NEW - pre-computed timeseries
        cycling.json           # Meters, protobuf JSON
        running.json
        yoga.json
      source/                  # NEW - raw daily data
        cycling.json
        running.json
        yoga.json
      distances.json           # OLD - kept until cleanup
      pacings.json             # OLD - kept until cleanup
      summary_activities.json  # OLD - kept until cleanup
    2023/
      ...
  _backups/
    2025-11-07_migration/
      distances.json           # Backups (all years)
      pacings.json
      summary_activities.json
```

### Migration Scripts

**1. backup-aggregations.sh**
```bash
# Backup existing data before migration
./scripts/data/backup-aggregations.sh [environment]

# Examples:
./scripts/data/backup-aggregations.sh dev
./scripts/data/backup-aggregations.sh prod
```
- Creates timestamped backup in `_backups/YYYY-MM-DD_migration/`
- Verifies all files copied successfully
- Safe to run multiple times (creates new backup each time)

**2. migrate_aggregations.py** (Python helper script)
```bash
# Migration script that reads from BigQuery
uv run python scripts/data/migrate_aggregations.py --project PROJECT_ID --years YEAR1 YEAR2

# Examples:
uv run python scripts/data/migrate_aggregations.py --project desirelines-dev --years 2024 --dry-run
uv run python scripts/data/migrate_aggregations.py --project desirelines-dev --years 2023 2024
```
- Reads activities from BigQuery (no Strava API calls)
- Converts to MinimalStravaActivity format
- Calls `run_batch()` to generate multi-sport aggregations
- Dry-run mode for preview
- Used by `migrate-to-multisport.sh`

**3. migrate-to-multisport.sh**
```bash
# Main migration orchestration script
./scripts/data/migrate-to-multisport.sh [environment]

# Examples:
./scripts/data/migrate-to-multisport.sh dev   # Test in dev first!
./scripts/data/migrate-to-multisport.sh prod
```
- Runs backup automatically
- Queries BigQuery for all years with data
- Runs migration script to regenerate aggregations
- Runs verification checks
- Provides detailed status output

**What it does**:
1. Backs up existing files
2. Queries BigQuery for all years with data
3. Runs `migrate_aggregations.py` to regenerate from BigQuery
   - Reads activities from BigQuery (no Strava API calls)
   - Calls `run_batch()` which writes multi-sport format
   - Uses existing data (no external API limits)
4. Waits for processing to complete
5. Runs verification script
6. Provides next steps

**4. verify-migration.sh**
```bash
# Verify migration succeeded
./scripts/data/verify-migration.sh [environment]

# Examples:
./scripts/data/verify-migration.sh dev
./scripts/data/verify-migration.sh prod
```

**Verification Checks**:
- ✅ Metadata files exist for each year
- ✅ Metrics directories contain sport-specific files
- ✅ Distance values are in meters (not miles)
- ✅ Totals match original data (accounting for conversion)
- ✅ File structure is correct

**5. cleanup-old-files.sh**
```bash
# Remove old files after successful migration
./scripts/data/cleanup-old-files.sh [environment]

# Examples:
./scripts/data/cleanup-old-files.sh dev
./scripts/data/cleanup-old-files.sh prod
```
- **WARNING**: Only run after verifying migration!
- Deletes old `*.json` files from `activities/`
- Verifies backup exists before deleting
- Backups remain in `_backups/` directory

**6. rollback-migration.sh**
```bash
# Rollback if migration fails
./scripts/data/rollback-migration.sh [environment] [backup-date]

# Examples:
./scripts/data/rollback-migration.sh dev
./scripts/data/rollback-migration.sh prod 2025-11-07
```
- Deletes new multi-sport structure
- Restores files from backup
- Auto-detects most recent backup if date not specified
- Verifies restoration succeeded

### Migration Workflow

**Step 1: Test in Dev**
```bash
# Run full migration in dev environment
./scripts/data/migrate-to-multisport.sh dev

# Verify results
./scripts/data/verify-migration.sh dev

# Check frontend works with new structure
# Visit: https://dev.desirelines.andyes.ch

# If all looks good, cleanup
./scripts/data/cleanup-old-files.sh dev
```

**Step 2: Migrate Production**
```bash
# Run production migration
./scripts/data/migrate-to-multisport.sh prod

# Verify results
./scripts/data/verify-migration.sh prod

# Test frontend
# Visit: https://desirelines.andyes.ch

# If verified, cleanup old files
./scripts/data/cleanup-old-files.sh prod
```

**Step 3: If Migration Fails**
```bash
# Rollback to original format
./scripts/data/rollback-migration.sh prod

# Check logs for error
gcloud logging read "resource.type=cloud_function AND textPayload:aggregat*" --limit 50
```

### Migration Checklist

Before migration:
- [ ] Aggregator updated to write multi-sport format (Task 3 complete)
- [ ] Test aggregator in dev environment
- [ ] Verify protobuf schemas deployed
- [ ] Verify sport configuration deployed

After migration:
- [ ] All years have `metadata.json` files
- [ ] Each year has `metrics/` and `source/` directories
- [ ] Cycling data exists for all expected years
- [ ] Distance values in meters (4-6 digits, not 2-3)
- [ ] Frontend displays correct values
- [ ] Sport navigation works
- [ ] No 404 errors on valid sport/year combinations

### Troubleshooting

**Issue: Cloud Function call fails**
```bash
# Check function exists
gcloud functions list --project=desirelines-prod

# Check logs
gcloud logging read "resource.type=cloud_function" --limit 50

# Trigger manually via PubSub instead
gcloud pubsub topics publish desirelines_activity_events \
  --project=desirelines-prod \
  --message='{"action": "aggregate", "year": 2024}'
```

**Issue: Distance values still in miles**
- Check aggregator code deployed correctly
- Verify protobuf schemas include `distance_meters` field
- Review Cloud Function logs for errors

**Issue: Missing sport files**
- Check if activities exist for that sport in BigQuery
- Verify sport configuration loaded correctly
- Check aggregator logs for categorization errors

**Issue: Backup not found during cleanup**
```bash
# List available backups
gsutil ls gs://desirelines-prod-desirelines-aggregation/_backups/

# Manually backup if needed
./scripts/data/backup-aggregations.sh prod
```

### Estimated Downtime

- **Dev environment**: ~10 minutes (not user-facing)
- **Production**: ~15-20 minutes
  - Frontend shows errors during migration
  - Run during low-traffic period if needed

### Related Documentation

- **Task**: `docs/planning/tasks/in-progress/multi-sport-04-backfill-migration.md`
- **Epic**: `docs/planning/epics/06-multi-sport-support.md`
- **Aggregator**: `packages/stravapipe/src/stravapipe/application/aggregator/`
- **Protobuf Schemas**: `schemas/protobuf/`

## Support

For issues or questions:
1. Check task documentation: `docs/planning/tasks/ready-to-start/production-data-backfill.md`
2. Review logs: `gcloud logging read "resource.type=cloud_function"`
3. File issue in project tracker
