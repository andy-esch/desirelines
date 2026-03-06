# Tell Pants to read dependencies from pyproject.toml
python_requirements(
    name="deps",
    source="pyproject.toml",
    resolve="stravapipe",
)

# Expose pyproject.toml as a file target for Docker builds
file(
    name="pyproject",
    source="pyproject.toml",
)


# =============================================================================
# Docker Image for Cloud Run (Python/FastAPI mono-image)
# =============================================================================
# Single image for all stravapipe services. Cloud Run overrides CMD per-service.
# Build context is this directory (packages/stravapipe)

# Source files for Docker build context (raw files, not PEX)
files(
    name="docker_sources",
    sources=[
        "pyproject.toml",
        "README.md",
        "src/**/*.py",
        "src/**/*.json",  # Include any JSON config files
        "!**/__pycache__/**",
        "!BUILD",
    ],
)

docker_image(
    name="stravapipe",
    source="Dockerfile",
    context_root="packages/stravapipe",
    dependencies=[":docker_sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",
    ],
    extra_build_args=["GIT_COMMIT"],
)
