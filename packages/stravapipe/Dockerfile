# Stravapipe Mono-Image — Cloud Run Services & Jobs (Python)
# Single image for all stravapipe entrypoints: bq-inserter, postgres-writer, backfill.
# Cloud Run overrides the CMD at deployment time for each service/job.
#
# Multi-stage build for optimal container size.

ARG PYTHON_VERSION=3.14

# Build stage
FROM python:${PYTHON_VERSION}-slim AS builder

WORKDIR /build

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /uvx /bin/

# Copy package files for dependency installation (context is packages/stravapipe)
COPY pyproject.toml README.md ./
COPY src/ ./src/

# Install the package with all dependencies using uv
RUN uv pip install --system --no-cache .

# Runtime stage
FROM python:${PYTHON_VERSION}-slim AS runtime

ARG PYTHON_VERSION=3.14

WORKDIR /app

# Copy installed packages from builder stage
COPY --from=builder /usr/local/lib/python${PYTHON_VERSION}/site-packages /usr/local/lib/python${PYTHON_VERSION}/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Run as non-root user
RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8080

# Default: bq-inserter (Cloud Run overrides this per-service)
CMD ["uvicorn", "stravapipe.cloudrun.bq_inserter_app:app", "--host", "0.0.0.0", "--port", "8080"]
