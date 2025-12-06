# Cloud Functions packaging via Pants
# Replaces scripts/operations/package-functions.sh (180 lines → ~40 lines)

# =============================================================================
# Docker Images (for Cloud Run deployments)
# Note: Dockerfiles now live in each package directory for cleaner organization
# =============================================================================

# Python function Docker images (optional - primarily use python_google_cloud_function)
docker_image(
    name="aggregator-docker",
    source="Dockerfile.aggregator",
)

docker_image(
    name="bq-inserter-docker",
    source="Dockerfile.bq_inserter",
)

# Go service Docker images for Cloud Run are defined in each package's BUILD file

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
