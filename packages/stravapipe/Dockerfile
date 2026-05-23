# Stravapipe Mono-Image — Cloud Run Services & Jobs (Python)
# Single image for all stravapipe entrypoints: bq-inserter, postgres-writer, backfill.
# Cloud Run overrides the CMD at deployment time for each service/job.
#
# Multi-stage build for optimal container size.
#
# Production deps install from `uv.lock` (`uv sync --frozen`) so every
# Docker build pins to exactly the same versions Pants and local dev
# resolve to. Without `--frozen`, the build would re-resolve from
# `pyproject.toml` against PyPI each time and drift independently.

ARG PYTHON_VERSION=3.14

# Build stage
FROM python:${PYTHON_VERSION}-slim AS builder

# Same WORKDIR as runtime so the venv ends up at /app/.venv in both
# stages — uv-generated entry-point scripts (uvicorn etc.) bake their
# interpreter path into the shebang at install time, so the builder and
# runtime venv paths MUST match or `exec uvicorn` fails with
# "no such file or directory" at runtime.
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /uvx /bin/

# UV_LINK_MODE=copy: cache mounts are on overlayfs, which doesn't support
# hardlinks — without this uv warns and falls back per-file.
# UV_PYTHON_DOWNLOADS=never: use the python:slim base image's interpreter,
# don't fetch one over the network.
ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Layer 1: install LOCKED dependencies only, without the project itself.
# This layer is cached until uv.lock or pyproject.toml changes; src/
# edits don't invalidate it.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Layer 2: install the project itself, non-editable. Cheap layer — the
# deps are already in the venv from above.
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-editable --no-dev

# Runtime stage
FROM python:${PYTHON_VERSION}-slim AS runtime

WORKDIR /app

# Copy the venv built above (same /app/.venv path in both stages — see
# the WORKDIR comment in the builder). Putting bin/ on PATH makes
# installed entry points (uvicorn etc.) resolve naturally; the CMD
# below is unchanged from the pre-venv image.
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Run as non-root user
RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8080

# Default: bq-inserter (Cloud Run overrides this per-service)
CMD ["uvicorn", "stravapipe.cloudrun.bq_inserter_app:app", "--host", "0.0.0.0", "--port", "8080"]
