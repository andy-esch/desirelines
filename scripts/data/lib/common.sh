#!/bin/bash
# Common functions for migration scripts
# Source this file in other scripts: source "$(dirname "$0")/lib/common.sh"

# Check if environment argument is provided
check_environment_arg() {
    local environment=$1

    if [ -z "$environment" ]; then
        echo "❌ ERROR: Environment argument is required"
        echo ""
        echo "Usage: $0 <environment>"
        echo ""
        echo "Valid environments:"
        echo "  - dev"
        echo "  - prod"
        echo ""
        echo "Example: $0 dev"
        exit 1
    fi

    if [ "$environment" != "dev" ] && [ "$environment" != "prod" ]; then
        echo "❌ ERROR: Invalid environment '${environment}'"
        echo ""
        echo "Valid environments: dev, prod"
        exit 1
    fi
}

# Verify current gcloud project matches environment
check_gcloud_project() {
    local environment=$1
    local expected_project="desirelines-${environment}"

    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        echo "❌ ERROR: gcloud CLI not found"
        echo ""
        echo "Install from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    # Check if authenticated
    local current_account=$(gcloud config get-value account 2>/dev/null)
    if [ -z "$current_account" ] || [ "$current_account" = "(unset)" ]; then
        echo "❌ ERROR: Not authenticated with gcloud"
        echo ""
        echo "Run: gcloud auth login"
        exit 1
    fi

    # Get current project
    local current_project=$(gcloud config get-value project 2>/dev/null)
    if [ -z "$current_project" ] || [ "$current_project" = "(unset)" ]; then
        echo "❌ ERROR: No gcloud project configured"
        echo ""
        echo "Run: gcloud config set project ${expected_project}"
        exit 1
    fi

    # Verify project matches environment
    if [ "$current_project" != "$expected_project" ]; then
        echo "❌ ERROR: gcloud project mismatch"
        echo ""
        echo "  Specified environment: ${environment}"
        echo "  Expected project:      ${expected_project}"
        echo "  Current project:       ${current_project}"
        echo ""
        echo "Switch to correct project:"
        echo "  gcloud config set project ${expected_project}"
        exit 1
    fi

    echo "✅ gcloud project verified: ${current_project}"
    echo "   Account: ${current_account}"
}

# Check required CLI tools are installed
check_required_tools() {
    local missing_tools=()

    # Check each required tool
    for tool in gsutil bq jq bc; do
        if ! command -v $tool &> /dev/null; then
            missing_tools+=($tool)
        fi
    done

    if [ ${#missing_tools[@]} -gt 0 ]; then
        echo "❌ ERROR: Missing required tools: ${missing_tools[*]}"
        echo ""
        echo "Installation instructions:"
        echo "  - gsutil/bq: Included with gcloud SDK"
        echo "  - jq: brew install jq (macOS) or apt-get install jq (Linux)"
        echo "  - bc: Usually pre-installed, or: brew install bc (macOS)"
        exit 1
    fi
}

# Verify GCS bucket exists
check_bucket_exists() {
    local bucket=$1

    if ! gsutil ls "gs://${bucket}" &> /dev/null; then
        echo "❌ ERROR: Bucket not found: gs://${bucket}"
        echo ""
        echo "Verify you have access to the bucket:"
        echo "  gsutil ls"
        exit 1
    fi

    echo "✅ Bucket verified: gs://${bucket}"
}

# Check if running in dry-run mode
is_dry_run() {
    [ "${DRY_RUN:-false}" = "true" ]
}

# Execute or print command based on dry-run mode
run_or_print() {
    if is_dry_run; then
        echo "[DRY RUN] $*"
    else
        "$@"
    fi
}

# Pretty print section header
print_section() {
    local title=$1
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$title"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Check if dev environment has been migrated (required before prod)
check_dev_migrated() {
    local current_env=$1

    if [ "$current_env" = "prod" ]; then
        local dev_bucket="desirelines-dev-desirelines-aggregation"

        # Check if dev has multi-sport structure
        if ! gsutil ls "gs://${dev_bucket}/activities/*/metadata.json" &> /dev/null; then
            echo "⚠️  WARNING: Dev environment does not appear to be migrated"
            echo ""
            echo "It is STRONGLY recommended to test migration in dev first:"
            echo "  1. Run: ./scripts/data/migrate-to-multisport.sh dev"
            echo "  2. Verify: ./scripts/data/verify-migration.sh dev"
            echo "  3. Test frontend with dev data"
            echo "  4. Then run: ./scripts/data/migrate-to-multisport.sh prod"
            echo ""
            read -p "Continue with prod migration anyway? (yes/no): " CONTINUE

            if [ "$CONTINUE" != "yes" ]; then
                echo "❌ Migration cancelled"
                exit 1
            fi
        else
            echo "✅ Dev environment already migrated"
        fi
    fi
}
