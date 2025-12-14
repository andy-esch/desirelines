# Cloud Functions packaging via Pants
# Note: bq-inserter and postgres-writer have been migrated to Cloud Run
# and their Docker images are now defined in packages/stravapipe/BUILD

# =============================================================================
# Python Source Files (only aggregator remains as Cloud Function)
# =============================================================================

python_sources(
    name="sources",
    sources=["aggregator.py"],
)

# =============================================================================
# Docker Images (for Cloud Run deployments)
# =============================================================================

# Aggregator Docker image (for potential future Cloud Run migration)
docker_image(
    name="aggregator-docker",
    source="Dockerfile.aggregator",
    dependencies=[
        "packages/stravapipe:pyproject",
        "packages/stravapipe:lib",
        ":sources",
    ],
)

# Note: bq-inserter and postgres-writer Docker images are now defined in
# packages/stravapipe/BUILD since they've been migrated to Cloud Run with FastAPI

# =============================================================================
# Python Cloud Functions (only aggregator remains)
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
        ":sources",
        "packages/stravapipe:lib",
    ],
    complete_platforms=[
        "build-support:cloud-functions-python312-x86_64",
    ],
)

# DEPRECATED: bq-inserter and postgres-writer have been migrated to Cloud Run
# See packages/stravapipe/BUILD for their docker_image targets
# See packages/stravapipe/src/stravapipe/cloudrun/ for their FastAPI apps
