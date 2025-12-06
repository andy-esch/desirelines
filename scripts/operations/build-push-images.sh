#!/bin/bash
# Build and push Cloud Run Docker images to Artifact Registry
#
# This script will be replaced by Pants docker_image targets in Phase 6d.
# For now, it provides a reproducible way to build and deploy images.
#
# Usage: ./scripts/operations/build-push-images.sh [git-sha]
# Examples:
#   ./scripts/operations/build-push-images.sh               # Build with current git SHA
#   ./scripts/operations/build-push-images.sh abc1234       # Build with specific SHA

set -euo pipefail

# Configuration
GCP_PROJECT=$(gcloud config get-value project 2>/dev/null)
REGION="us-central1"
REGISTRY="${REGION}-docker.pkg.dev/${GCP_PROJECT}/desirelines-functions"

if [ -z "$GCP_PROJECT" ]; then
    echo "❌ Error: No GCP project set in gcloud config"
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

# Git SHA for tagging (default to current HEAD)
TAG="${1:-$(git rev-parse --short HEAD)}"

echo "🔨 Building and pushing Cloud Run images"
echo "  Project: ${GCP_PROJECT}"
echo "  Registry: ${REGISTRY}"
echo "  Tag: ${TAG}"
echo ""

# Build and push dispatcher
echo "📦 Building dispatcher..."
docker build \
    -t "${REGISTRY}/dispatcher:${TAG}" \
    -t "${REGISTRY}/dispatcher:latest" \
    -f packages/dispatcher/Dockerfile \
    packages/dispatcher

echo "📤 Pushing dispatcher:${TAG}..."
docker push "${REGISTRY}/dispatcher:${TAG}"
docker push "${REGISTRY}/dispatcher:latest"
echo "✅ Dispatcher pushed"
echo ""

# Build and push apigateway
echo "📦 Building apigateway..."
docker build \
    -t "${REGISTRY}/apigateway:${TAG}" \
    -t "${REGISTRY}/apigateway:latest" \
    -f packages/apigateway/Dockerfile \
    packages/apigateway

echo "📤 Pushing apigateway:${TAG}..."
docker push "${REGISTRY}/apigateway:${TAG}"
docker push "${REGISTRY}/apigateway:latest"
echo "✅ API Gateway pushed"
echo ""

echo "✅ All images built and pushed successfully!"
echo ""
echo "🚀 Deploy with Terraform:"
echo "  cd terraform/environments/${GCP_PROJECT#desirelines-}"
echo "  terraform apply -var=\"deployment_version=${TAG}\""
