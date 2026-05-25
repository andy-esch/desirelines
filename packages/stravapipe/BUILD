# Tell Pants to read dependencies from pyproject.toml
python_requirements(
    name="deps",
    source="pyproject.toml",
    resolve="stravapipe",
    overrides={
        # Pants's default module inference maps `google.cloud.X` → `google-cloud-X`
        # by name, which gets confused when two packages share the namespace
        # (`google-cloud-bigquery` and `google-cloud-bigquery-storage`). Without
        # this override, imports of `google.cloud.bigquery_storage_v1` are
        # incorrectly attributed to `google-cloud-bigquery` and the right
        # package never makes it into the requirements PEX.
        "google-cloud-bigquery-storage": {
            "modules": [
                "google.cloud.bigquery_storage",
                "google.cloud.bigquery_storage_v1",
            ],
        },
        # Same shape of problem on the OTel side: GCP / OTLP exporter
        # packages have PyPI names that don't match their importable
        # module paths (e.g. `opentelemetry-exporter-gcp-trace` provides
        # `opentelemetry.exporter.cloud_trace`). Without these overrides
        # Pants's default heuristic can't link imports of those module
        # paths to the right PyPI package, so anything that imports them
        # at top level (e.g. the tracing tests' mock setup) fails with
        # ModuleNotFoundError under the Pants-built PEX. Production
        # tracing.py imports them lazily inside `setup_tracing()`, which
        # is why production code paths happen to work without the
        # overrides — top-level usage needs them.
        "opentelemetry-exporter-gcp-trace": {
            "modules": ["opentelemetry.exporter.cloud_trace"],
        },
        "opentelemetry-exporter-otlp-proto-grpc": {
            "modules": ["opentelemetry.exporter.otlp.proto.grpc"],
        },
        "opentelemetry-resourcedetector-gcp": {
            "modules": ["opentelemetry.resourcedetector.gcp_resource_detector"],
        },
    },
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
        # `uv.lock` is the production resolve — the Dockerfile installs
        # via `uv sync --frozen` so prod pins to the same versions as
        # local dev and (transitively) CI.
        "uv.lock",
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
    # Note: CI builds use docker/build-push-action directly (see .github/workflows/deploy.yml)
)
