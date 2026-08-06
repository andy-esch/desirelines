# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
# Stravapipe Mono-Image — Cloud Run Services & Jobs (Python 3.14, distroless).
# One image for all entrypoints: bq-inserter, postgres-writer,
# deletion-service, backfill. Cloud Run overrides command/args per
# service/job at deploy time.
#
# Distroless: no shell, no package manager, no OS utilities — minimal
# attack surface. CPython 3.14 itself is installed by uv into
# /opt/python in the builder and copied across; the venv at /app/.venv
# references the interpreter by absolute path. Production deps install
# from uv.lock via `uv sync --frozen` so every build pins to exactly
# the versions Pants's stravapipe.lock and local uv.lock resolve to.

# Runtime base tag. Default `nonroot` (no shell). For local debugging
# build with `--build-arg DISTROLESS_TAG=debug-nonroot` for busybox.
ARG DISTROLESS_TAG=nonroot

# Pin both stages to linux/amd64. Cloud Run is amd64-only; CI runners are
# amd64 — so amd64 is *the* target architecture, not a default. Without
# this pin, building on Apple Silicon (or any arm64 host) silently
# produces an arm64 image that won't match production, and the
# arch-specific paths below (e.g. `/usr/lib/x86_64-linux-gnu/libz.so.*`)
# get miscopied with no obvious error. Local builds on arm64 hosts pay a
# qemu emulation cost but stay correct.

# ============================================================
# Builder — debian:bookworm-slim matches distroless/cc-debian12's
# glibc, so the uv-managed interpreter and native wheels are
# ABI-compatible end-to-end.
# ============================================================
FROM --platform=linux/amd64 debian:bookworm-slim AS builder

# psycopg-binary's auditwheel-bundled libpq dlopens libz at runtime;
# distroless/cc has glibc + libstdc++ + libgcc but NOT libz. Install
# zlib1g in the builder so we can COPY libz into the runtime stage.
# (debian:bookworm-slim doesn't ship libz by default either.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends zlib1g \
    && rm -rf /var/lib/apt/lists/*

# uv: pinned, matches the runtime image just below this comment block.
COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /uvx /bin/

# UV_LINK_MODE=copy: cache mounts are on overlayfs, which doesn't
#   support hardlinks; without this, uv warns and falls back per-file
#   (and a COPY --from across stages can't carry hardlinks anyway).
# UV_COMPILE_BYTECODE=1: pre-compile .pyc at install time so the first
#   request doesn't pay the import-compile cost on cold start.
# UV_PYTHON_INSTALL_DIR=/opt/python: stable absolute path that the
#   venv's pyvenv.cfg + .venv/bin/python symlink reference. The runtime
#   stage MUST copy the interpreter to this same path.
# UV_PYTHON_PREFERENCE=only-managed: never reach for a system Python
#   (debian:bookworm-slim doesn't ship 3.14 anyway, but make it explicit).
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PYTHON_PREFERENCE=only-managed

# WORKDIR MUST equal the runtime WORKDIR. uv writes an absolute shebang
# (e.g. `#!/app/.venv/bin/python`) into the venv's console scripts; if
# the venv is built at a different path, `exec uvicorn` fails at runtime
# with "no such file or directory" — and distroless has no shell to
# diagnose it. Build the venv where it will run.
WORKDIR /app

# Standalone CPython, pinned to a specific patch (matches
# `.python-version`). Without the patch, `uv python install 3.14`
# resolves to whatever 3.14.x is latest at build time → builds drift.
RUN uv python install 3.14.7

# Prune the standalone CPython stdlib of server-irrelevant directories.
# uv ships python-build-standalone's "install_only" tarball (no
# `install_only_stripped` variant exposed by uv yet), which is tuned
# for portability over minimum size: `idlelib`, `tkinter`, `ensurepip`,
# `turtledemo` are all unused by these Cloud Run services. The CPython
# test suite is already excluded by `install_only`.
#
# Post-hoc `strip` of the interpreter was tried and reverted —
# `--strip-unneeded` corrupts the version symbols in
# python-build-standalone's portably-linked binaries (`python:slim`
# strips at compile time via `-Wl,--strip-all`, which is different).
# Modest win from prune alone (~5 MB); deeper size reduction is
# tracked separately.
RUN find /opt/python -depth -type d \( \
        -name idlelib -o -name ensurepip -o -name tkinter -o -name turtledemo \
    \) -exec rm -rf {} +

# Layer 1: install LOCKED dependencies only, without the project.
# Cached until uv.lock or pyproject.toml changes; src/ edits below
# don't invalidate it.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Layer 2: build + install stravapipe itself as a non-editable wheel.
# `--no-editable` is MANDATORY here: a plain `uv sync` installs the
# project editable, leaving a finder that points at the builder's
# `src/` — which does not exist in the runtime image, so
# `import stravapipe` fails with ModuleNotFoundError. Non-editable
# packages `src/` into the venv as a wheel, byte-identical to the
# pre-distroless `uv pip install .` (same uv_build backend, same
# pyproject.toml) — so data files (`config/sport_types.json`,
# generated `*_pb2.py`) come along unchanged.
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-editable --no-dev

# ============================================================
# Runtime — distroless/cc: glibc + libstdc++6 + libgcc1, no shell.
# `cc` is required (not the smaller `base`) because grpcio's manylinux
# wheel dynamically links libstdc++.so.6 / libgcc_s.so.1. psycopg-binary
# bundles its own libpq via auditwheel and needs only glibc — `cc`
# covers both. distroless/python3 ships Debian 12's Python 3.11, so it
# can't host this 3.14 project; we bring our own interpreter from
# /opt/python instead.
# ============================================================
FROM --platform=linux/amd64 gcr.io/distroless/cc-debian12:${DISTROLESS_TAG} AS runtime

WORKDIR /app

# Interpreter — MUST land at UV_PYTHON_INSTALL_DIR; the venv's
# pyvenv.cfg + .venv/bin/python symlink reference it by absolute path.
COPY --from=builder --chown=65532:65532 /opt/python /opt/python

# Virtualenv at the same /app/.venv path it was built at (shebang
# requirement — see the WORKDIR comment in the builder). stravapipe is
# installed inside .venv via --no-editable, so no src/ tree is copied.
COPY --from=builder --chown=65532:65532 /app/.venv /app/.venv

# libz for psycopg-binary's bundled libpq (see the apt-get in the
# builder). The dynamic linker searches /usr/lib/x86_64-linux-gnu/
# (default x86_64 multiarch path); the `--platform=linux/amd64` pin on
# both stages guarantees that's the right arch.
COPY --from=builder /usr/lib/x86_64-linux-gnu/libz.so.* /usr/lib/x86_64-linux-gnu/

# PATH puts `uvicorn` and `python` on PATH so the unchanged Cloud Run /
# docker-compose `command`/`args` resolve. PYTHONUNBUFFERED for log
# liveness on Cloud Run; PYTHONDONTWRITEBYTECODE because the bytecode
# was already compiled in the builder (UV_COMPILE_BYTECODE=1).
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080

# Explicit non-root user (defense-in-depth). distroless/cc:nonroot
# already defaults to uid 65532, but pinning here means a future
# `--build-arg DISTROLESS_TAG=debug` (without `-nonroot`) doesn't
# silently downgrade us to running as root.
USER 65532:65532

# Default: bq-inserter (Cloud Run overrides this per service/job).
CMD ["uvicorn", "stravapipe.cloudrun.bq_inserter_app:app", "--host", "0.0.0.0", "--port", "8080"]
