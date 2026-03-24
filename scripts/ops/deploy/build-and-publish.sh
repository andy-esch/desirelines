#!/bin/bash
# Build and publish all Docker images to Artifact Registry
#
# Usage: ./scripts/ops/deploy/build-and-publish.sh [SHA]
# Examples:
#   ./scripts/ops/deploy/build-and-publish.sh               # Use current git SHA
#   ./scripts/ops/deploy/build-and-publish.sh abc1234       # Use specific SHA

set -euo pipefail

SHA=${1:-$(git rev-parse --short HEAD)}
REGISTRY="us-central1-docker.pkg.dev"
REPOSITORY="desirelines-artifacts/desirelines-services"

echo "Building and publishing all Docker images (SHA: $SHA)"
echo ""

# Ensure Docker can push to Artifact Registry
gcloud auth configure-docker "$REGISTRY" --quiet

# =============================================================================
# Build and push each service
# =============================================================================
declare -A SERVICES=(
	[dispatcher]="packages/dispatcher/Dockerfile:."
	[apigateway]="packages/apigateway/Dockerfile:."
	[stravapipe]="packages/stravapipe/Dockerfile:packages/stravapipe"
)

for service in "${!SERVICES[@]}"; do
	IFS=':' read -r dockerfile context <<< "${SERVICES[$service]}"
	image="${REGISTRY}/${REPOSITORY}/${service}"

	echo "Building ${service}..."
	docker buildx build \
		--file "$dockerfile" \
		--tag "${image}:${SHA}" \
		--tag "${image}:latest" \
		--push \
		"$context"
	echo ""
done

# =============================================================================
# Summary
# =============================================================================
echo "All images published to Artifact Registry:"
echo ""
for service in "${!SERVICES[@]}"; do
	echo "  - ${service}:${SHA} + ${service}:latest"
done
echo ""
echo "Next step: deploy by merging to main (triggers CI -> deploy repo)"
echo "Or manually from desirelines-deploy repo"
echo ""
