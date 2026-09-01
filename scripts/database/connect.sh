#!/usr/bin/env bash
# Connect to PostgreSQL database via psql
# Usage: ./scripts/database/connect.sh dev|prod [--admin|--apigateway|--writer]

set -euo pipefail

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
# Secrets are managed in Infisical and synced to GCP Secret Manager
case "$ROLE_FLAG" in
  --admin)
    ROLE="admin"
    SECRET_NAME="INFISICAL_POSTGRES_CONN_ADMIN"
    ;;
  --apigateway)
    ROLE="apigateway (read-only)"
    SECRET_NAME="INFISICAL_POSTGRES_CONN_APIGATEWAY"
    ;;
  --writer)
    ROLE="writer"
    SECRET_NAME="INFISICAL_POSTGRES_CONN_WRITER"
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

# Parse the connection string so the password never reaches psql's argv, where
# any co-tenant could read it from `ps aux` / /proc/<pid>/cmdline for the life of
# the session. Same sed shapes as scripts/database/migrate.sh:70-72 — one parser
# for one URI format, rather than a second dialect to keep in sync.
# Per docs/guides/secure-scripting.md §1 ("No Secrets in Args").
DB_USER=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://([^:]+):.*|\1|')
DB_PASSWORD=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://[^:]+:(.+)@.*|\1|')
URL_WITHOUT_CREDS=$(echo "$CONNECTION_STRING" | sed -E 's|^postgresql://.+@|postgresql://|')

if [[ -z "$DB_USER" || -z "$DB_PASSWORD" || "$URL_WITHOUT_CREDS" == "$CONNECTION_STRING" ]]; then
  echo -e "${RED}❌ Could not parse the connection string into user/password/host${NC}"
  echo -e "${YELLOW}Expected postgresql://user:password@host/database?params${NC}"
  exit 1
fi

# Intentionally do not echo DB_USER, DB_PASSWORD, or CONNECTION_STRING — they
# contain credentials. Per docs/guides/secure-scripting.md ("No Echoing Secrets").

# Connect via psql
echo -e "${GREEN}🚀 Connecting to PostgreSQL...${NC}"
# PGPASSWORD is exported only for this psql invocation, so it is not inherited
# by anything the session spawns (e.g. psql's \! shell escape).
PGPASSWORD="$DB_PASSWORD" psql "$URL_WITHOUT_CREDS" --username "$DB_USER"
