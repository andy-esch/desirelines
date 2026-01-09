# Webhook dispatcher Go package
# Routes Strava webhooks to PubSub

go_mod(
    name="mod",
)

go_package(
    name="lib",
)

# All source files for Docker build context
files(
    name="sources",
    sources=[
        "go.mod",
        "go.sum",
        "cmd/dispatcher/*.go",
        "config/*.go",
        "adapters/**/*.go",
        "domain/*.go",
        "middleware/*.go",
        "pkg/**/*.go",
        "ports/**/*.go",
        "types/**/*.go",
        "!**/BUILD",           # Exclude all BUILD files
    ],
)

# Docker image for Cloud Run deployment
docker_image(
    name="dispatcher",
    source="Dockerfile",
    # Build context: packages/dispatcher directory (where go.mod, go.sum, and source files are)
    context_root="packages/dispatcher",
    dependencies=[":sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",  # Interpolated from GIT_COMMIT build arg
    ],
    extra_build_args=["GIT_COMMIT"],  # Pass as Docker build arg (value from env var)
    # Repository configured in pants.toml [docker] section
    # Output: us-central1-docker.pkg.dev/desirelines-dev/desirelines-functions/dispatcher:latest
)
