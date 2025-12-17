#!/bin/bash
# Connect to PostgreSQL database via psql
# Usage: ./scripts/database/connect.sh dev|prod [--admin|--apigateway|--writer]

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
ROLE_FLAG="${2:---admin}"

if [[ -z "$ENVIRONMENT" ]]; then
  echo -e "${RED}Usage: ./scripts/database/connect.sh dev|prod [--admin|--apigateway|--writer]${NC}"
  echo ""
  echo "Roles:"
  echo "  --admin      Full admin access (default)"
  echo "  --apigateway Read-only access (apigateway role)"
  echo "  --writer     Write access (postgres-writer role)"
  exit 1
fi

if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
  echo -e "${RED}Environment must be 'dev' or 'prod'${NC}"
  exit 1
fi

# Determine which secret to use based on role
case "$ROLE_FLAG" in
  --admin)
    ROLE="admin"
    SECRET_NAME="postgres-conn-admin-${ENVIRONMENT}"
    ;;
  --apigateway)
    ROLE="apigateway (read-only)"
    SECRET_NAME="postgres-conn-apigateway-${ENVIRONMENT}"
    ;;
  --writer)
    ROLE="writer"
    SECRET_NAME="postgres-conn-writer-${ENVIRONMENT}"
    ;;
  *)
    echo -e "${RED}Role flag must be --admin, --apigateway, or --writer${NC}"
    exit 1
    ;;
esac

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
echo -e "${YELLOW}📥 Fetching connection string from Secret Manager (${SECRET_NAME})...${NC}"
CONNECTION_STRING=$(gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project="${PROJECT_ID}" 2>/dev/null || true)

if [[ -z "$CONNECTION_STRING" ]]; then
  echo -e "${RED}❌ Failed to fetch connection string from Secret Manager${NC}"
  echo -e "${YELLOW}Make sure you have access to secret: ${SECRET_NAME}${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Connection string retrieved${NC}"
echo ""

# Connect via psql
echo -e "${GREEN}🚀 Connecting to PostgreSQL...${NC}"
psql "$CONNECTION_STRING"
