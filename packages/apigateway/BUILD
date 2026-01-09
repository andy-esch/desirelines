# API Gateway Go package
# Serves aggregated data to web frontend

go_mod(
    name="mod",
)

go_package(
    name="lib",
    # Protobuf imports will be auto-inferred from schemas/proto
    # Generated .pb.go files are in types/generated/
)
# All source files for Docker build context
files(
  name="sources",
  sources=[
    "**/*.go",                  # All Go files recursively
    "*.mod",                    # go.mod
    "*.sum",                    # go.sum
    "!BUILD",
    "config/sport_types.json",  # Embedded JSON file for go:embed
  ],
)

# Docker image for Cloud Run deployment
docker_image(
    name="apigateway",
    source="Dockerfile",
    # Build context: packages/apigateway directory (where go.mod, go.sum, and source files are)
    context_root="packages/apigateway",
    dependencies=[":sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",  # Interpolated from GIT_COMMIT build arg
    ],
    extra_build_args=["GIT_COMMIT"],  # Pass as Docker build arg (value from env var)
    # Repository configured in pants.toml [docker] section
    # Output: us-central1-docker.pkg.dev/desirelines-dev/desirelines-functions/apigateway:latest
)
