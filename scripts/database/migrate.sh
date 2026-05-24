#!/bin/bash
# Run Flyway operations against dev or prod database
# Usage: ./scripts/database/migrate.sh dev|prod [--dry-run|clean]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
# BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
ENVIRONMENT="${1:-}"
COMMAND_ARG="${2:-}"

if [[ -z "$ENVIRONMENT" ]]; then
	echo -e "${RED}Usage: ./scripts/database/migrate.sh dev|prod [--dry-run|clean]${NC}"
	exit 1
fi

if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
	echo -e "${RED}Environment must be 'dev' or 'prod'${NC}"
	exit 1
fi

# Get GCP project ID based on environment
if [[ "$ENVIRONMENT" == "dev" ]]; then
	PROJECT_ID="desirelines-dev"
elif [[ "$ENVIRONMENT" == "prod" ]]; then
	PROJECT_ID="desirelines-prod"
fi

# Verify gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &>/dev/null; then
	echo -e "${RED}❌ Not authenticated with gcloud. Run: gcloud auth login${NC}"
	exit 1
fi

# Get connection string from Secret Manager
# Use flyway connection string (has schema management permissions)
# Secrets are managed in Infisical and synced to GCP Secret Manager
SECRET_NAME="INFISICAL_POSTGRES_CONN_FLYWAY"
echo -e "${YELLOW}📥 Fetching connection string from Secret Manager (${SECRET_NAME})...${NC}"
CONNECTION_STRING=$(gcloud secrets versions access latest \
	--secret="${SECRET_NAME}" \
	--project="${PROJECT_ID}" 2>/dev/null || true)

if [[ -z "$CONNECTION_STRING" ]]; then
	echo -e "${RED}❌ Failed to fetch connection string from Secret Manager${NC}"
	echo -e "${YELLOW}Make sure you have access to secret: ${SECRET_NAME}${NC}"
	exit 1
fi

# Parse connection string to extract user, password, and URL without credentials
# Format: postgresql://user:password@host/database?params
DB_USER=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://([^:]+):.*|\1|')
DB_PASSWORD=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://[^:]+:(.+)@.*|\1|')
URL_WITHOUT_CREDS=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://.+@|postgresql://|')
JDBC_URL="jdbc:${URL_WITHOUT_CREDS}"

# Intentionally do not echo DB_USER, DB_PASSWORD, or JDBC_URL — they contain
# credentials. Per docs/guides/secure-scripting.md ("No Echoing Secrets").
echo -e "${GREEN}✅ Connection string retrieved and parsed${NC}"
echo ""

# Build Flyway Docker image
echo -e "${YELLOW}🏗️  Building Flyway Docker image...${NC}"
cd "${PROJECT_ROOT}/schemas/database"
docker build -t desirelines-flyway . --quiet

# Determine Flyway command
if [[ "$COMMAND_ARG" == "clean" ]]; then
	FLYWAY_COMMAND="clean"
	echo -e "${RED}⚠️  WARNING: About to CLEAN ${ENVIRONMENT} database (drops all objects in desirelines schema)!${NC}"
	read -rp "Are you sure? (y/N): " confirm

	if [[ "$confirm" != "y" ]] && [[ "$confirm" != "Y" ]]; then
		echo -e "${RED}❌ Database clean cancelled${NC}"
		exit 1
	fi

	echo -e "${YELLOW}🧹 Cleaning ${ENVIRONMENT} database...${NC}"
elif [[ "$COMMAND_ARG" == "--dry-run" ]]; then
	FLYWAY_COMMAND="info"
	echo -e "${YELLOW}🔍 DRY RUN: Showing migration status (not running migrations)${NC}"
else
	FLYWAY_COMMAND="migrate"

	# Production safety check
	if [[ "$ENVIRONMENT" == "prod" ]]; then
		echo -e "${RED}⚠️  WARNING: About to run migrations against PRODUCTION database!${NC}"
		echo ""
		read -rp "Are you sure you want to continue? (yes/NO): " confirm

		if [[ "$confirm" != "yes" ]]; then
			echo -e "${RED}❌ Migration cancelled${NC}"
			exit 1
		fi
	fi

	echo -e "${GREEN}🚀 Running migrations against ${ENVIRONMENT} database...${NC}"
fi

# Run Flyway with JDBC URL and separate credentials
docker run --rm \
	-e FLYWAY_URL="${JDBC_URL}" \
	-e FLYWAY_USER="${DB_USER}" \
	-e FLYWAY_PASSWORD="${DB_PASSWORD}" \
	desirelines-flyway "${FLYWAY_COMMAND}"

echo ""
echo -e "${GREEN}✅ Flyway ${FLYWAY_COMMAND} completed successfully${NC}"
