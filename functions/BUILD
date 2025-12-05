# Cloud Functions packaging via Pants
# Replaces scripts/operations/package-functions.sh (180 lines → ~40 lines)

# =============================================================================
# Docker Images (for Cloud Run deployments)
# Note: Dockerfiles now live in each package directory for cleaner organization
# =============================================================================

# Python function Docker images (optional - primarily use python_google_cloud_function)
docker_image(
    name="aggregator-docker",
    source="Dockerfile.activity_aggregator",
)

docker_image(
    name="bq-inserter-docker",
    source="Dockerfile.activity_bq_inserter",
)

# Go service Docker images - reference Dockerfiles in package directories
docker_image(
    name="dispatcher-image",
    source="../packages/dispatcher/Dockerfile",
)

docker_image(
    name="apigateway-image",
    source="../packages/apigateway/Dockerfile",
)

# =============================================================================
# Python Cloud Functions
# =============================================================================
# Pants uses PEX to package pre-resolved dependencies directly:
# 1. Resolves dependencies from pyproject.toml
# 2. Pre-resolves for Linux (GCP runtime)
# 3. Packages dependency code directly in zip (no GCP build step needed)

python_google_cloud_function(
    name="aggregator",
    type="event",
    # runtime="python312",
    handler="aggregator.py:main",
    dependencies=[
        "packages/stravapipe:lib",
    ],
    complete_platforms=[
        "build-support:cloud-functions-python312-x86_64",
    ],
)

python_google_cloud_function(
    name="bq-inserter",
    type="event",
    # runtime="python312",
    handler="bq_inserter.py:main",
    dependencies=[
        "packages/stravapipe:lib",
    ],
    complete_platforms=[
        "build-support:cloud-functions-python312-x86_64",
    ],
)
