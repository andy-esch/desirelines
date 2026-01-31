#!/bin/bash
# Build and publish all artifacts via Pants
#
# Usage: ./scripts/ops/deploy/build-and-publish.sh [SHA]
# Examples:
#   ./scripts/ops/deploy/build-and-publish.sh               # Use current git SHA
#   ./scripts/ops/deploy/build-and-publish.sh abc1234       # Use specific SHA

set -euo pipefail

SHA=${1:-$(git rev-parse --short HEAD)}

echo "🔧 Building and publishing all artifacts (SHA: $SHA)"
echo ""

# =============================================================================
# Cloud Run - Build and publish Docker images
# =============================================================================
echo "🐳 Building and publishing Cloud Run images..."
GIT_COMMIT=$SHA pants publish \
	packages/dispatcher:dispatcher \
	packages/apigateway:apigateway \
	packages/stravapipe:bq-inserter \
	packages/stravapipe:postgres-writer

echo "✅ Docker images published to Artifact Registry"
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All artifacts ready for deployment!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🐳 Docker images (in Artifact Registry):"
echo "   - dispatcher:${SHA} + dispatcher:latest"
echo "   - apigateway:${SHA} + apigateway:latest"
echo "   - bq-inserter:${SHA} + bq-inserter:latest"
echo "   - postgres-writer:${SHA} + postgres-writer:latest"
echo "   → Already published and ready to deploy"
echo ""
echo "🚀 Next step - Deploy by merging to main (triggers CI → deploy repo)"
echo "   Or manually from desirelines-deploy repo"
echo ""
