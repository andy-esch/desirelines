#!/usr/bin/env bash

# Deploy web application to Firebase Hosting
# Usage: ./scripts/ops/deploy/deploy-web.sh <environment>
# Example: ./scripts/ops/deploy/deploy-web.sh dev
#
# This script:
# 1. Builds the web app with environment-specific configuration
# 2. Deploys to Firebase Hosting using firebase CLI
#
# Prerequisites:
# - Firebase CLI installed (npm install -g firebase-tools)
# - Firebase Hosting infrastructure created via Terraform
# - Authenticated with firebase CLI (firebase login)

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
WEB_DIR="${PROJECT_ROOT}/packages/web"

# Check arguments
if [ $# -ne 1 ]; then
  echo "❌ Error: Please specify environment"
  echo "Usage: $0 <environment>"
  echo "Example: $0 dev"
  echo ""
  echo "Valid environments: local, dev, prod"
  exit 1
fi

ENVIRONMENT="$1"

# Map environment to Firebase project and validate
case "$ENVIRONMENT" in
local)
  FIREBASE_PROJECT="desirelines-local"
  ;;
dev)
  FIREBASE_PROJECT="desirelines-dev"
  ;;
prod)
  FIREBASE_PROJECT="desirelines-prod"
  ;;
*)
  echo "❌ Error: Invalid environment: $ENVIRONMENT"
  echo "Valid environments: local, dev, prod"
  exit 1
  ;;
esac

# Cleanup trap to ensure secret files are removed
trap 'rm -f .env.staging.local .env.production.local' EXIT

echo "🚀 Deploying web application to Firebase Hosting"
echo "📍 Environment: $ENVIRONMENT"
echo "🎯 Firebase Project: $FIREBASE_PROJECT"
echo "📦 Web Directory: $WEB_DIR"
echo ""

# Check if Firebase CLI is installed
if ! command -v firebase &>/dev/null; then
  echo "❌ Error: Firebase CLI not found"
  echo "   Install: npm install -g firebase-tools"
  echo "   Then run: firebase login"
  exit 1
fi

# Check if Infisical CLI is installed
if ! command -v infisical &>/dev/null; then
  echo "❌ Error: Infisical CLI not found"
  echo "   Install: brew install infisical/tap/infisical"
  echo "   Then run: infisical login"
  exit 1
fi

# Check if web directory exists
if [ ! -d "$WEB_DIR" ]; then
  echo "❌ Error: Web directory not found: $WEB_DIR"
  exit 1
fi

# Navigate to web directory
cd "$WEB_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
  echo "❌ Error: package.json not found in $WEB_DIR"
  exit 1
fi

# Fetch secrets from Infisical
echo "🔑 Fetching secrets from Infisical..."
if [ "$ENVIRONMENT" = "dev" ]; then
  echo "   Exporting dev secrets to .env.staging.local..."
  if ! infisical export --env=dev --path=/frontend >.env.staging.local; then
    echo "❌ Error: Failed to export secrets from Infisical"
    echo "   Ensure you are logged in (infisical login) and have access to /frontend"
    exit 1
  fi
elif [ "$ENVIRONMENT" = "prod" ]; then
  echo "   Exporting prod secrets to .env.production.local..."
  if ! infisical export --env=prod --path=/frontend >.env.production.local; then
    echo "❌ Error: Failed to export secrets from Infisical"
    exit 1
  fi
fi
echo "✅ Secrets exported"

# Validate exported secrets
echo "🔍 Validating exported secrets..."
ENV_FILE=""
if [ "$ENVIRONMENT" = "dev" ]; then
  ENV_FILE=".env.staging.local"
elif [ "$ENVIRONMENT" = "prod" ]; then
  ENV_FILE=".env.production.local"
fi

if [ -n "$ENV_FILE" ]; then
  if ! grep -q "^VITE_" "$ENV_FILE"; then
    echo "❌ Error: No VITE_ variables found in $ENV_FILE"
    echo "   Ensure your Infisical secrets in /frontend are prefixed with VITE_"
    exit 1
  fi
  # The /routes map needs a public pk.* Mapbox token. Require it explicitly so a
  # missing Infisical key fails here rather than silently shipping a token-less
  # map (or a committed placeholder).
  if ! grep -qE "^VITE_MAPBOX_TOKEN=['\"]?pk\." "$ENV_FILE"; then
    echo "❌ Error: VITE_MAPBOX_TOKEN (public pk.* token) missing from $ENV_FILE"
    echo "   Add it to Infisical /frontend for env '$ENVIRONMENT' (see packages/web/README.md)"
    exit 1
  fi
  echo "✅ Validation passed"
fi
echo ""

# Build web application with environment-specific mode
echo "📦 Building web application..."
if [ "$ENVIRONMENT" = "local" ]; then
  # Local uses test mode (fixture-only, no backend)
  echo "   Running: npm run build -- --mode test"
  if ! npm run build -- --mode test; then
    echo "❌ Error: Build failed"
    exit 1
  fi
elif [ "$ENVIRONMENT" = "dev" ]; then
  # Dev uses staging mode (deployed dev with Cloud Run URLs)
  # Note: "development" mode is for local dev (npm run dev with localhost)
  echo "   Running: npm run build -- --mode staging"
  if ! npm run build -- --mode staging; then
    echo "❌ Error: Build failed"
    exit 1
  fi
else
  # Prod uses production mode (smart mode with prod API Gateway)
  echo "   Running: npm run build -- --mode production"
  if ! npm run build -- --mode production; then
    echo "❌ Error: Build failed"
    exit 1
  fi
fi
echo "✅ Build complete"
echo ""

# Check if build directory exists
if [ ! -d "build" ]; then
  echo "❌ Error: Build directory not found after build"
  echo "   Expected: $WEB_DIR/build"
  exit 1
fi

# Set Firebase project
echo "🔧 Setting Firebase project to $FIREBASE_PROJECT..."
if ! firebase use "$FIREBASE_PROJECT" --project "$FIREBASE_PROJECT"; then
  echo "❌ Error: Failed to set Firebase project"
  echo "   Make sure you're authenticated: firebase login"
  echo "   And the project exists in .firebaserc"
  exit 1
fi
echo ""

# Deploy to Firebase Hosting and Firestore Rules
echo "🚀 Deploying to Firebase Hosting and Firestore Rules..."
if ! firebase deploy --only hosting,firestore:rules --project "$FIREBASE_PROJECT"; then
  echo "❌ Error: Deployment failed"
  exit 1
fi

echo ""
echo "✅ Deployment complete!"
echo "🌐 Web app URL: https://${FIREBASE_PROJECT}.web.app"

# Show custom domain for production
if [ "$ENVIRONMENT" = "prod" ]; then
  echo "🌐 Custom domain: https://desirelines.andyes.ch"
fi

echo ""
echo "📝 Next steps:"
echo "   - Visit the URL above to verify deployment"
echo "   - Check browser console for any errors"
echo "   - Test all interactive features"
