#!/bin/bash
# Backup existing aggregation files before multi-sport migration
#
# Usage:
#   ./scripts/data/backup-aggregations.sh <environment>
#   ./scripts/data/backup-aggregations.sh dev
#   ./scripts/data/backup-aggregations.sh prod
#
# Requirements:
#   - gcloud authenticated and project set correctly
#   - gsutil installed
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
BACKUP_DATE=$(date +%Y-%m-%d)
BACKUP_PATH="_backups/${BACKUP_DATE}_migration"

check_bucket_exists "$BUCKET"

print_section "🔄 Starting backup for ${ENVIRONMENT} environment"

echo "   Source: gs://${BUCKET}/activities/*/{{distances,pacings,summary_activities}}.json"
echo "   Destination: gs://${BUCKET}/${BACKUP_PATH}/"
echo ""

# Check if source files exist
echo "Checking for files to backup..."
SAMPLE_YEAR=$(gsutil ls "gs://${BUCKET}/activities/" | grep -o '[0-9]\{4\}' | head -1)

if [ -z "$SAMPLE_YEAR" ]; then
    echo "❌ No year directories found in gs://${BUCKET}/activities/"
    exit 1
fi

# Check for old-format files (distances.json, pacings.json, summary_activities.json)
if ! gsutil ls "gs://${BUCKET}/activities/${SAMPLE_YEAR}/distances.json" > /dev/null 2>&1; then
    echo "❌ No old-format files found to backup"
    echo "   Either migration already ran, or data structure is different than expected"
    echo ""
    echo "   Expected files like: gs://${BUCKET}/activities/YYYY/distances.json"
    echo "   Run 'gsutil ls gs://${BUCKET}/activities/${SAMPLE_YEAR}/' to see what exists"
    exit 1
fi

# Count files to backup
FILE_COUNT=0
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    COUNT=$(gsutil ls "gs://${BUCKET}/activities/*/${pattern}" 2>/dev/null | wc -l | tr -d ' ')
    FILE_COUNT=$((FILE_COUNT + COUNT))
done

echo "✅ Found ${FILE_COUNT} files to backup across all years"
echo ""

# Create backup directory and copy files
echo "Copying files to backup location..."
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    echo "   Backing up ${pattern} files..."
    gsutil -m cp "gs://${BUCKET}/activities/*/${pattern}" \
        "gs://${BUCKET}/${BACKUP_PATH}/" 2>/dev/null || true
done

echo "✅ Backup complete"
echo ""

# Verify backup
echo "🔍 Verifying backup..."
BACKUP_COUNT=$(gsutil ls "gs://${BUCKET}/${BACKUP_PATH}/" | grep -c '\.json$' || echo "0")

if [ "$FILE_COUNT" -eq "$BACKUP_COUNT" ]; then
    echo "✅ Backup verified: ${BACKUP_COUNT} files copied successfully"
    echo ""
    echo "Backup location: gs://${BUCKET}/${BACKUP_PATH}/"
else
    echo "⚠️  Backup file count mismatch"
    echo "   Expected: ${FILE_COUNT} files"
    echo "   Found: ${BACKUP_COUNT} files"
    echo ""
    echo "   This might be OK if some years don't have all file types."
    echo "   Listing backed up files:"
    gsutil ls "gs://${BUCKET}/${BACKUP_PATH}/"
fi

# List backed up files
echo ""
echo "Backed up files by type:"
for pattern in "distances.json" "pacings.json" "summary_activities.json"; do
    COUNT=$(gsutil ls "gs://${BUCKET}/${BACKUP_PATH}/" | grep -c "$pattern" || echo "0")
    echo "   ${pattern}: ${COUNT} files"
done
