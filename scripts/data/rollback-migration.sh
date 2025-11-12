#!/bin/bash
# Rollback multi-sport migration to original format
#
# Use this if migration fails or causes issues.
# Restores files from _backups/ and removes new multi-sport structure.
#
# Usage:
#   ./scripts/data/rollback-migration.sh <environment> [backup-date]
#   ./scripts/data/rollback-migration.sh dev
#   ./scripts/data/rollback-migration.sh dev 2025-11-07
#   ./scripts/data/rollback-migration.sh prod 2025-11-07
#
# Requirements:
#   - gcloud authenticated and project set correctly
#   - gsutil installed
#   - Backup must exist

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# Parse arguments
ENVIRONMENT=$1
BACKUP_DATE=$2

# Guardrails
check_environment_arg "$ENVIRONMENT"
check_required_tools
check_gcloud_project "$ENVIRONMENT"

# Configuration
BUCKET="desirelines-${ENVIRONMENT}-desirelines-aggregation"

check_bucket_exists "$BUCKET"

print_section "⚠️  ROLLBACK: Reverting multi-sport migration"

echo "   Environment: ${ENVIRONMENT}"
echo "   Bucket: gs://${BUCKET}"
echo ""

# Find backup if not specified
if [ -z "$BACKUP_DATE" ]; then
    echo "Finding most recent backup..."
    BACKUP_DATE=$(gsutil ls "gs://${BUCKET}/_backups/" 2>/dev/null | \
        grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | \
        sort -r | head -1)

    if [ -z "$BACKUP_DATE" ]; then
        echo "❌ ERROR: No backups found and no backup date specified"
        echo ""
        echo "Usage: $0 ${ENVIRONMENT} YYYY-MM-DD"
        exit 1
    fi

    echo "✅ Found backup: ${BACKUP_DATE}"
fi

BACKUP_PATH="_backups/${BACKUP_DATE}_migration"

echo ""
echo "Backup location: gs://${BUCKET}/${BACKUP_PATH}/"
echo ""

# Verify backup exists
if ! gsutil ls "gs://${BUCKET}/${BACKUP_PATH}/*.json" > /dev/null 2>&1; then
    echo "❌ ERROR: Backup not found at gs://${BUCKET}/${BACKUP_PATH}/"
    echo ""
    echo "Available backups:"
    gsutil ls "gs://${BUCKET}/_backups/" || echo "   (none found)"
    exit 1
fi

BACKUP_COUNT=$(gsutil ls "gs://${BUCKET}/${BACKUP_PATH}/*.json" | wc -l | tr -d ' ')
echo "✅ Backup verified: ${BACKUP_COUNT} files found"
echo ""

# Safety check
echo "⚠️  WARNING: This will:"
echo "   1. Delete all multi-sport directories (activities/YYYY/)"
echo "   2. Restore old *.json files from backup"
echo ""
read -p "Continue with rollback? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Rollback cancelled"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Removing new multi-sport structure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Delete new year directories (but keep _backups/)
YEAR_DIRS=$(gsutil ls "gs://${BUCKET}/activities/" | grep -E '/[0-9]{4}/$' || echo "")

if [ -n "$YEAR_DIRS" ]; then
    echo "Deleting multi-sport directories..."
    echo "$YEAR_DIRS" | sed 's|gs://[^/]*/activities/|   - |' | sed 's|/$||'
    echo ""

    echo "$YEAR_DIRS" | while read -r DIR; do
        gsutil -m rm -r "$DIR" 2>/dev/null || true
    done

    echo "✅ Multi-sport directories deleted"
else
    echo "✅ No multi-sport directories found (already clean)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Restoring from backup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Copying ${BACKUP_COUNT} files from backup..."
gsutil -m cp "gs://${BUCKET}/${BACKUP_PATH}/*.json" \
    "gs://${BUCKET}/activities/"

echo ""
echo "✅ Files restored from backup"
echo ""

# Verify restoration
RESTORED_COUNT=$(gsutil ls "gs://${BUCKET}/activities/*.json" 2>/dev/null | wc -l | tr -d ' ')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$RESTORED_COUNT" -eq "$BACKUP_COUNT" ]; then
    echo "✅ Rollback successful!"
    echo "   Restored ${RESTORED_COUNT} files"
    echo ""
    echo "Restored files:"
    gsutil ls "gs://${BUCKET}/activities/*.json" | sed 's|gs://[^/]*/activities/|   - |'
else
    echo "⚠️  File count mismatch!"
    echo "   Expected: ${BACKUP_COUNT} files"
    echo "   Restored: ${RESTORED_COUNT} files"
    echo ""
    echo "   Please verify manually"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Rollback complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "System restored to pre-migration state"
echo "Backup preserved at: gs://${BUCKET}/${BACKUP_PATH}/"
echo ""
