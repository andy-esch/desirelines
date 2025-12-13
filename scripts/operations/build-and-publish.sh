#!/bin/bash
# Build and publish all artifacts via Pants
# Replaces: package-functions.sh (180 lines) + build-push-images.sh (67 lines)
#
# Usage: ./scripts/operations/build-and-publish.sh [SHA]
# Examples:
#   ./scripts/operations/build-and-publish.sh               # Use current git SHA
#   ./scripts/operations/build-and-publish.sh abc1234       # Use specific SHA

set -euo pipefail

SHA=${1:-$(git rev-parse --short HEAD)}

echo "🔧 Building and publishing all artifacts (SHA: $SHA)"
echo ""

# =============================================================================
# Cloud Functions - Package source code
# =============================================================================
echo "📦 Packaging Cloud Functions..."
pants package functions:aggregator functions:bq-inserter functions:postgres-writer

echo "✅ Cloud Functions packaged to dist/"
echo ""

# =============================================================================
# Cloud Run - Build and publish Docker images
# =============================================================================
echo "🐳 Building and publishing Cloud Run images..."
GIT_COMMIT=$SHA pants publish \
  packages/dispatcher:dispatcher \
  packages/apigateway:apigateway

echo "✅ Docker images published to Artifact Registry"
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All artifacts ready for deployment!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 Cloud Function source packages (in dist/):"
echo "   - aggregator-${SHA}.zip"
echo "   - bq-inserter-${SHA}.zip"
echo "   - postgres-writer-${SHA}.zip"
echo "   → Terraform will upload these to GCS during apply"
echo ""
echo "🐳 Docker images (in Artifact Registry):"
echo "   - dispatcher:${SHA} + dispatcher:latest"
echo "   - apigateway:${SHA} + apigateway:latest"
echo "   → Already published and ready to deploy"
echo ""
echo "🚀 Next step - Deploy with Terraform:"
echo "   cd terraform/environments/dev"
echo "   terraform apply -var=\"deployment_version=${SHA}\""
echo ""
