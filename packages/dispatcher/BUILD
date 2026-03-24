# Webhook dispatcher Go package
# Routes Strava webhooks to PubSub

go_mod(
    name="mod",
)

# All source files for Docker build context
files(
    name="sources",
    sources=[
        "go.mod",
        "go.sum",
        "**/*.go",
        "!**/BUILD",
    ],
)

# Docker image for Cloud Run deployment
docker_image(
    name="dispatcher",
    source="Dockerfile",
    # Build context: repo root to allow access to local 'shared' package
    context_root=".",
    dependencies=[
        ":sources",
        "packages/shared:sources",
    ],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",  # Interpolated from GIT_COMMIT build arg
    ],
    extra_build_args=["GIT_COMMIT"],  # Pass as Docker build arg (value from env var)
    # Repository configured in pants.toml [docker] section
    # Output: us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/dispatcher:latest
    # Note: CI builds use docker/build-push-action directly (see .github/workflows/deploy.yml)
)
