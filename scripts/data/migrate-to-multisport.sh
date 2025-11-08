#!/bin/bash
# Migrate existing aggregation data to multi-sport format
#
# This script:
# 1. Backs up existing data
# 2. Re-runs aggregator for all years (writes new multi-sport format)
# 3. Verifies migration succeeded
#
# Usage:
#   ./scripts/data/migrate-to-multisport.sh <environment> [--dry-run]
#   ./scripts/data/migrate-to-multisport.sh dev
#   ./scripts/data/migrate-to-multisport.sh prod
#   ./scripts/data/migrate-to-multisport.sh dev --dry-run
#
# Requirements:
#   - gcloud authenticated and project set correctly
#   - gsutil, bq, jq installed
#   - Cloud Functions deployed
#   - Dev environment migrated (before running prod)

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# Parse arguments
ENVIRONMENT=$1
DRY_RUN=false

if [ "$2" = "--dry-run" ]; then
    DRY_RUN=true
    export DRY_RUN
fi

# Guardrails
check_environment_arg "$ENVIRONMENT"
check_required_tools
check_gcloud_project "$ENVIRONMENT"
check_dev_migrated "$ENVIRONMENT"

# Configuration
PROJECT_ID="desirelines-${ENVIRONMENT}"
BUCKET="desirelines-${ENVIRONMENT}-desirelines-aggregation"

check_bucket_exists "$BUCKET"

if is_dry_run; then
    print_section "🔍 DRY RUN MODE - No changes will be made"
fi

print_section "🚀 Multi-sport migration for ${ENVIRONMENT}"

echo "   Project: ${PROJECT_ID}"
echo "   Bucket: gs://${BUCKET}"
echo ""

# Safety check
if ! is_dry_run; then
    read -p "⚠️  This will migrate data to multi-sport format. Continue? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "❌ Migration cancelled"
        exit 1
    fi
fi

# Step 1: Backup
print_section "📦 Step 1: Backing up existing data"

if is_dry_run; then
    echo "[DRY RUN] Would run: ./scripts/data/backup-aggregations.sh ${ENVIRONMENT}"
else
    "${SCRIPT_DIR}/backup-aggregations.sh" "${ENVIRONMENT}"
fi

# Step 2: Get years from BigQuery
print_section "🔍 Step 2: Finding years to migrate"

YEARS=$(bq query --use_legacy_sql=false --format=csv --max_rows=100 \
  "SELECT DISTINCT EXTRACT(YEAR FROM start_date) as year
   FROM \`${PROJECT_ID}.desirelines.activities\`
   ORDER BY year" | tail -n +2)

if [ -z "$YEARS" ]; then
    echo "❌ No years found in BigQuery"
    exit 1
fi

YEAR_COUNT=$(echo "$YEARS" | wc -l | tr -d ' ')
echo "✅ Found ${YEAR_COUNT} years to migrate:"
echo "$YEARS" | sed 's/^/   - /'
echo ""

# Step 3: Run migration script for all years
print_section "🔄 Step 3: Regenerating aggregations from BigQuery"

echo "Using migration script to regenerate multi-sport aggregations from BigQuery"
echo "   Source: BigQuery activities table (no Strava API calls)"
echo "   Target: New multi-sport format (metadata.json, metrics/, source/)"
echo ""

if is_dry_run; then
    echo "[DRY RUN] Would run:"
    echo "  cd /path/to/desirelines"
    echo "  uv run python scripts/data/migrate_aggregations.py --project ${PROJECT_ID} --years ${YEARS}"
else
    # Get script directory and project root
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

    echo "Migrating years: ${YEARS}"
    echo "This will:"
    echo "  1. Read activities from BigQuery (no Strava API calls)"
    echo "  2. Regenerate aggregations in new multi-sport format"
    echo "  3. Write to: activities/YYYY/metadata.json, metrics/*, source/*"
    echo ""

    # Convert YEARS to array
    YEARS_ARRAY=($YEARS)

    # Run migration script (reads from BigQuery, no Strava API calls)
    cd "${PROJECT_ROOT}"
    uv run python scripts/data/migrate_aggregations.py --project "${PROJECT_ID}" --years "${YEARS_ARRAY[@]}"

    if [ $? -ne 0 ]; then
        echo "❌ Migration failed - check logs above"
        exit 1
    fi

    echo ""
    echo "✅ Migration completed for all years"
fi

echo ""
if is_dry_run; then
    echo "[DRY RUN] Would trigger aggregation for ${YEAR_COUNT} years"
else
    echo "✅ Aggregation triggered for all years"
    echo "   Note: Processing happens asynchronously - verification will check results"
fi
echo ""

# Wait for processing to complete
if ! is_dry_run; then
    echo "⏳ Waiting 30 seconds for aggregation to complete..."
    sleep 30
    echo ""
fi

# Step 4: Verification
print_section "🔍 Step 4: Verifying migration"

if is_dry_run; then
    echo "[DRY RUN] Would run: ./scripts/data/verify-migration.sh ${ENVIRONMENT}"
else
    "${SCRIPT_DIR}/verify-migration.sh" "${ENVIRONMENT}"
fi

print_section "✅ Migration complete!"

echo ""
echo "Next steps:"
echo "  1. Review verification output above"
echo "  2. Test frontend with new data structure"
echo "  3. Verify sport-specific pages work"
if ! is_dry_run; then
    echo "  4. If all looks good, cleanup old files:"
    echo "     ./scripts/data/cleanup-old-files.sh ${ENVIRONMENT}"
fi
echo ""
