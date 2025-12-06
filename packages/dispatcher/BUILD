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
        "*.go",                # All root Go files
        "*.mod",               # go.mod
        "*.sum",               # go.sum
        "!BUILD",              # Exclude the BUILD file itself
        "cmd/dispatcher/*.go"  # Include application entrypoint main.go
    ],
)

# Docker image for Cloud Run deployment
docker_image(
    name="dispatcher",
    source="Dockerfile",
    # Build context: packages/dispatcher directory (where go.mod, go.sum, and source files are)
    context_root="packages/dispatcher",
    dependencies=[":sources"],
    image_tags=["latest"],
    # Repository configured in pants.toml [docker] section
    # Output: us-central1-docker.pkg.dev/desirelines-dev/desirelines-functions/dispatcher:latest
    # TODO: Add git SHA tag using {pants.tag} placeholder (requires --tag flag at build time)
)
