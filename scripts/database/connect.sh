#!/bin/bash
# Connect to PostgreSQL database via psql
# Usage: ./scripts/database/connect.sh dev|prod [--admin|--readonly]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
ENVIRONMENT="${1:-}"
ROLE_FLAG="${2:---readonly}"

if [[ -z "$ENVIRONMENT" ]]; then
  echo -e "${RED}Usage: ./scripts/database/connect.sh dev|prod [--admin|--readonly]${NC}"
  exit 1
fi

if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
  echo -e "${RED}Environment must be 'dev' or 'prod'${NC}"
  exit 1
fi

# Determine which role to use
if [[ "$ROLE_FLAG" == "--admin" ]]; then
  ROLE="admin"
  SECRET_SUFFIX="admin"
elif [[ "$ROLE_FLAG" == "--readonly" ]]; then
  ROLE="readonly"
  SECRET_SUFFIX="readonly"
else
  echo -e "${RED}Role flag must be --admin or --readonly${NC}"
  exit 1
fi

echo -e "${GREEN}🔌 Connecting to ${ENVIRONMENT} database (${ROLE} role)...${NC}"

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
echo -e "${YELLOW}📥 Fetching connection string from Secret Manager...${NC}"
CONNECTION_STRING=$(gcloud secrets versions access latest \
  --secret="postgres-connection-string-${ENVIRONMENT}" \
  --project="${PROJECT_ID}" 2>/dev/null || true)
CONNECTION_STRING=${CONNECTION_STRING/+psycopg/}

if [[ -z "$CONNECTION_STRING" ]]; then
  echo -e "${RED}❌ Failed to fetch connection string from Secret Manager${NC}"
  echo -e "${YELLOW}Make sure you have access to secret: postgres-connection-string-${ENVIRONMENT}${NC}"
  exit 1
fi

# For readonly/admin users, we might need to modify the connection string
# if we've created separate role-specific credentials
# For now, use the main connection string (assumes it's using the Neon default role)

echo -e "${GREEN}✅ Connection string retrieved${NC}"
echo -e "${YELLOW}⚠️  Note: Currently using default Neon credentials${NC}"
echo -e "${YELLOW}    After creating individual roles, you'll need role-specific secrets${NC}"
echo ""

# Connect via psql
echo -e "${GREEN}🚀 Connecting to PostgreSQL...${NC}"
psql "$CONNECTION_STRING"
