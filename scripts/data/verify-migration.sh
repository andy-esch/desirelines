#!/bin/bash
# Verify multi-sport migration succeeded
#
# Checks:
# - Metadata files exist for each year
# - Metrics directories exist with sport-specific files
# - Distance values are in meters (not miles)
# - Totals match original data (accounting for unit conversion)
#
# Usage:
#   ./scripts/data/verify-migration.sh <environment>
#   ./scripts/data/verify-migration.sh dev
#   ./scripts/data/verify-migration.sh prod
#
# Requirements:
#   - gcloud authenticated and project set correctly
#   - gsutil, jq, bc installed
#   - Access to GCS bucket

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# Guardrails
check_environment_arg "$1"
check_required_tools
check_gcloud_project "$1"

# Configuration
ENVIRONMENT=$1
BUCKET="desirelines-${ENVIRONMENT}-desirelines-aggregation"

check_bucket_exists "$BUCKET"

print_section "🔍 Verifying multi-sport migration for ${ENVIRONMENT}"

echo "   Bucket: gs://${BUCKET}"
echo ""

# Check 1: Metadata files
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check 1: Metadata files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

METADATA_COUNT=$(gsutil ls "gs://${BUCKET}/activities/*/metadata.json" 2>/dev/null | wc -l | tr -d ' ')

if [ "$METADATA_COUNT" -gt 0 ]; then
    echo "✅ Found ${METADATA_COUNT} metadata files"
    gsutil ls "gs://${BUCKET}/activities/*/metadata.json" | sed 's|gs://[^/]*/activities/|   - |' | sed 's|/metadata.json||'
else
    echo "❌ No metadata files found!"
    echo "   Migration may have failed - check Cloud Function logs"
    exit 1
fi

echo ""

# Check 2: Metrics directories
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check 2: Metrics directories"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

METRICS_DIRS=$(gsutil ls "gs://${BUCKET}/activities/*/metrics/" 2>/dev/null | wc -l | tr -d ' ')

if [ "$METRICS_DIRS" -gt 0 ]; then
    echo "✅ Found ${METRICS_DIRS} metrics directories"
    echo ""
    echo "Sample structure (most recent year):"
    LATEST_YEAR=$(gsutil ls "gs://${BUCKET}/activities/" | grep -o '[0-9]\{4\}' | sort -nr | head -1)
    if [ -n "$LATEST_YEAR" ]; then
        gsutil ls "gs://${BUCKET}/activities/${LATEST_YEAR}/" | sed 's|gs://[^/]*/activities/[0-9]*/|   |'
    fi
else
    echo "❌ No metrics directories found!"
    exit 1
fi

echo ""

# Check 3: Sport-specific files
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check 3: Sport-specific metrics files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CYCLING_FILES=$(gsutil ls "gs://${BUCKET}/activities/*/metrics/cycling.json" 2>/dev/null | wc -l | tr -d ' ')
RUNNING_FILES=$(gsutil ls "gs://${BUCKET}/activities/*/metrics/running.json" 2>/dev/null | wc -l | tr -d ' ')
YOGA_FILES=$(gsutil ls "gs://${BUCKET}/activities/*/metrics/yoga.json" 2>/dev/null | wc -l | tr -d ' ')

echo "   Cycling: ${CYCLING_FILES} years"
echo "   Running: ${RUNNING_FILES} years"
echo "   Yoga: ${YOGA_FILES} years"

if [ "$CYCLING_FILES" -gt 0 ]; then
    echo ""
    echo "✅ Sport-specific files found"
else
    echo ""
    echo "❌ No sport-specific files found!"
    exit 1
fi

echo ""

# Check 4: Verify units (meters vs miles)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check 4: Verify distance units (should be meters)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get a sample distance value from most recent cycling data
LATEST_YEAR=$(gsutil ls "gs://${BUCKET}/activities/" | grep -o '[0-9]\{4\}' | sort -nr | head -1)

if [ -n "$LATEST_YEAR" ]; then
    CYCLING_FILE="gs://${BUCKET}/activities/${LATEST_YEAR}/metrics/cycling.json"

    if gsutil -q stat "$CYCLING_FILE"; then
        # Check if distance_meters field exists
        HAS_METERS=$(gsutil cat "$CYCLING_FILE" | jq 'has("timeseries") and .timeseries | has("distance_meters")' 2>/dev/null || echo "false")

        if [ "$HAS_METERS" = "true" ]; then
            # Get first non-zero distance value
            SAMPLE_DISTANCE=$(gsutil cat "$CYCLING_FILE" | jq -r '
                .timeseries.distance_meters[] |
                select(.value > 0) |
                .value
            ' 2>/dev/null | head -1)

            if [ -n "$SAMPLE_DISTANCE" ] && [ "$SAMPLE_DISTANCE" != "null" ]; then
                # Distances in meters should be 4-6 digits (1000-999999m)
                # Distances in miles would be 1-3 digits (1-999mi)
                if (( $(echo "$SAMPLE_DISTANCE > 1000" | bc -l) )); then
                    echo "✅ Distance appears to be in meters"
                    echo "   Sample value: ${SAMPLE_DISTANCE}m (${LATEST_YEAR} cycling)"
                else
                    echo "⚠️  Distance seems suspiciously low: ${SAMPLE_DISTANCE}m"
                    echo "   This might indicate miles instead of meters!"
                fi
            else
                echo "⚠️  Could not extract sample distance value"
            fi
        else
            echo "⚠️  No distance_meters field found in ${LATEST_YEAR}/metrics/cycling.json"
            echo "   File may be using old format"
        fi
    else
        echo "⚠️  No cycling data found for ${LATEST_YEAR}"
    fi
else
    echo "⚠️  Could not determine latest year"
fi

echo ""

# Check 5: Compare totals with backup (if available)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check 5: Compare totals with original data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Find most recent backup
BACKUP_DATE=$(gsutil ls "gs://${BUCKET}/_backups/" 2>/dev/null | \
    grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | \
    sort -r | head -1)

if [ -n "$BACKUP_DATE" ] && [ -n "$LATEST_YEAR" ]; then
    OLD_FILE="gs://${BUCKET}/_backups/${BACKUP_DATE}_migration/${LATEST_YEAR}.json"
    NEW_FILE="gs://${BUCKET}/activities/${LATEST_YEAR}/metadata.json"

    if gsutil -q stat "$OLD_FILE" && gsutil -q stat "$NEW_FILE"; then
        # Get old total (in miles)
        OLD_TOTAL=$(gsutil cat "$OLD_FILE" | \
            jq '[.[] | select(.distance_miles != null) | .distance_miles] | add' 2>/dev/null || echo "null")

        # Get new total (in meters) - check for cycling in totals
        NEW_TOTAL=$(gsutil cat "$NEW_FILE" | \
            jq '.totals.cycling.distance_meters // 0' 2>/dev/null || echo "null")

        if [ "$OLD_TOTAL" != "null" ] && [ "$NEW_TOTAL" != "null" ] && [ "$OLD_TOTAL" != "0" ]; then
            # Convert old miles to meters (1 mile = 1609.34 meters)
            EXPECTED=$(echo "$OLD_TOTAL * 1609.34" | bc)
            DIFF=$(echo "$NEW_TOTAL - $EXPECTED" | bc | awk '{print ($1<0)?-$1:$1}')
            PERCENT=$(echo "scale=2; ($DIFF / $EXPECTED) * 100" | bc)

            echo "   ${LATEST_YEAR} totals:"
            echo "   - Original: ${OLD_TOTAL} miles"
            echo "   - New: ${NEW_TOTAL} meters"
            echo "   - Expected: ${EXPECTED} meters"
            echo "   - Difference: ${PERCENT}%"
            echo ""

            if (( $(echo "$PERCENT < 1" | bc -l) )); then
                echo "✅ Totals match within 1% (accounting for conversion)"
            else
                echo "⚠️  Totals differ by ${PERCENT}% - may need investigation"
            fi
        else
            echo "⚠️  Could not compare totals (data not available)"
        fi
    else
        echo "⚠️  Backup or new data not found for comparison"
    fi
else
    echo "⚠️  Could not find backup for comparison"
fi

echo ""

# Final summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Verification complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Summary:"
echo "  - ${METADATA_COUNT} years migrated"
echo "  - ${CYCLING_FILES} years with cycling data"
echo "  - ${RUNNING_FILES} years with running data"
echo "  - ${YOGA_FILES} years with yoga data"
echo ""
