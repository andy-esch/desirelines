#!/bin/bash
# Cleanup old aggregation files after successful multi-sport migration
#
# IMPORTANT: Only run this AFTER verifying migration succeeded!
# Old files are still available in _backups/ after cleanup.
#
# Usage:
#   ./scripts/data/cleanup-old-files.sh <environment>
#   ./scripts/data/cleanup-old-files.sh dev
#   ./scripts/data/cleanup-old-files.sh prod
#
# Requirements:
#   - gcloud authenticated and project set correctly
#   - gsutil installed
#   - Backup must exist before cleanup

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

print_section "🗑️  Cleanup old files for ${ENVIRONMENT} environment"

echo "   Bucket: gs://${BUCKET}"
echo ""

# Check if old files exist
SAMPLE_YEAR=$(gsutil ls "gs://${BUCKET}/activities/" | grep -o '[0-9]\{4\}' | head -1)

if [ -z "$SAMPLE_YEAR" ]; then
    echo "✅ No year directories found - nothing to cleanup"
    exit 0
fi

if ! gsutil ls "gs://${BUCKET}/activities/${SAMPLE_YEAR}/distances.json" > /dev/null 2>&1; then
    echo "✅ No old-format files found - cleanup already complete or not needed"
    exit 0
fi

# Count old files
FILE_COUNT=0
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    COUNT=$(gsutil ls "gs://${BUCKET}/activities/*/${pattern}" 2>/dev/null | wc -l | tr -d ' ')
    FILE_COUNT=$((FILE_COUNT + COUNT))
done

echo "Found ${FILE_COUNT} old files to delete:"
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    COUNT=$(gsutil ls "gs://${BUCKET}/activities/*/${pattern}" 2>/dev/null | wc -l | tr -d ' ')
    echo "   ${pattern}: ${COUNT} files"
done
echo ""

# Verify backup exists
BACKUP_COUNT=$(gsutil ls "gs://${BUCKET}/_backups/*/*.json" 2>/dev/null | wc -l | tr -d ' ')

if [ "$BACKUP_COUNT" -eq 0 ]; then
    echo "❌ ERROR: No backup files found in gs://${BUCKET}/_backups/"
    echo "   Cannot safely cleanup without backup!"
    echo ""
    echo "   Run backup first: ./scripts/data/backup-aggregations.sh ${ENVIRONMENT}"
    exit 1
fi

echo "✅ Backup verified: ${BACKUP_COUNT} files in _backups/"
echo ""

# Safety check
echo "⚠️  WARNING: This will DELETE old-format files from activities/YYYY/"
echo ""
echo "Files to delete:"
echo "   - distances.json (all years)"
echo "   - pacings.json (all years)"
echo "   - summary_activities.json (all years)"
echo ""
echo "Old files will still be available in:"
echo "   gs://${BUCKET}/_backups/"
echo ""
read -p "Continue with cleanup? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Cleanup cancelled"
    exit 1
fi

echo ""
echo "Deleting old files..."

# Delete old-format files
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    echo "   Deleting ${pattern} files..."
    gsutil -m rm "gs://${BUCKET}/activities/*/${pattern}" 2>/dev/null || true
done

echo ""
echo "✅ Cleanup complete"
echo ""
echo "Deleted ${FILE_COUNT} old files from activities/"
echo "Backups still available at: gs://${BUCKET}/_backups/"
echo ""
