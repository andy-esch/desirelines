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

## Support

For issues or questions:
1. Check task documentation: `docs/planning/tasks/ready-to-start/production-data-backfill.md`
2. Review logs: `gcloud logging read "resource.type=cloud_function"`
3. File issue in project tracker
