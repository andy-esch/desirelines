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

python_sources(
    name="lib",
    # Exclude generated protobuf files - they're handled by types/generated/BUILD
    sources=["src/**/*.py", "!src/stravapipe/types/generated/*_pb2.py"],
    resolve="stravapipe",
    # Overrides for specific files
    overrides={
        # sport_config.py needs JSON resource dependency
        # Pants can't auto-infer Path(__file__).parent / "file.json" dependencies
        "src/stravapipe/config/sport_config.py": {
            "dependencies": ["packages/stravapipe/src/stravapipe/config:sport_config_json"],
        },
    },
)

# =============================================================================
# Docker Images for Cloud Run (Python/FastAPI services)
# =============================================================================
# Build context is this directory (packages/stravapipe)
# Dockerfiles reference paths relative to this directory

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
    name="bq-inserter",
    source="Dockerfile.bq_inserter",
    context_root="packages/stravapipe",
    dependencies=[":docker_sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",
    ],
    extra_build_args=["GIT_COMMIT"],
)

docker_image(
    name="postgres-writer",
    source="Dockerfile.postgres_writer",
    context_root="packages/stravapipe",
    dependencies=[":docker_sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",
    ],
    extra_build_args=["GIT_COMMIT"],
)

docker_image(
    name="backfill",
    source="Dockerfile.backfill",
    context_root="packages/stravapipe",
    dependencies=[":docker_sources"],
    image_tags=[
        "latest",
        "{build_args.GIT_COMMIT}",
    ],
    extra_build_args=["GIT_COMMIT"],
)
