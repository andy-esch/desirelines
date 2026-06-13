"""Readiness probe helpers for Cloud Run services.

Mirrors the apigateway pattern (packages/apigateway/internal/health/handler.go):
each service exposes a cheap /health for liveness and a deeper /ready that
exercises its primary dependency. /ready is hit hourly by Cloud Scheduler,
not on every Cloud Run probe — keep the underlying probes light. Each
invocation wakes Neon's compute for its idle window, which is the dominant
DB-active driver, so avoid pinging the DB more than necessary.
"""

import asyncio
from collections.abc import Awaitable, Callable
import logging
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from google.cloud.firestore_v1 import Client as FirestoreClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.shared.constants import ResponseStatus
from stravapipe.shared.responses import HealthResponse

logger = logging.getLogger(__name__)


def register_health_route(app: FastAPI) -> None:
    """Register the shared /health liveness probe on a Cloud Run app.

    The /health handler is byte-identical across every stravapipe Cloud Run
    app (process-alive only, no dependency checks), so it lives here as the
    single definition. /ready stays per-app — each service's readiness
    docstring and dependency-check set genuinely differ.
    """

    @app.get("/health")
    async def health() -> HealthResponse:
        """Liveness probe — process-alive only, no dependency checks."""
        return HealthResponse(status=ResponseStatus.HEALTHY)


# Per-attempt timeout. Sized for cold-start tail latency (Neon for postgres-writer,
# BigQuery / Firestore for the others). The hourly Cloud Scheduler probe almost
# always lands on a suspended dependency, so a tighter budget flags every cold
# wake as "unhealthy" even when the underlying service is fine.
DEFAULT_READINESS_TIMEOUT: float = 10.0

# Pause between the initial probe and the single retry. Per Neon's official
# cold-start guidance: pair a longer per-attempt timeout with a brief retry to
# absorb tail wake-time without inflating the timeout to absurd values. One
# retry is enough — genuine outages will keep failing on attempt #2.
DEFAULT_READINESS_RETRY_BACKOFF: float = 1.0


async def _run_with_timeout(
    name: str,
    probe: Callable[[], Awaitable[None]],
    timeout: float,  # noqa: ASYNC109 — applying the timeout is the function's whole job; rule's "use asyncio.timeout at call site" guidance would just spread the same code across every readiness handler
    retry_backoff: float = DEFAULT_READINESS_RETRY_BACKOFF,
) -> str | None:
    """Run a probe with one retry after backoff. None on success, error on final failure.

    Each attempt gets the full per-attempt timeout. retry_backoff=0 disables
    the inter-attempt sleep (used in tests). The first attempt's failure is
    logged at WARN regardless of whether the retry succeeds, so transient
    cold-start spikes stay visible.
    """

    async def _attempt() -> str | None:
        try:
            await asyncio.wait_for(probe(), timeout=timeout)
        except TimeoutError:
            return f"{name}: timeout"
        except Exception as exc:
            return f"{name}: {exc}"
        return None

    first_err = await _attempt()
    if first_err is None:
        return None

    logger.warning(
        "Readiness probe '%s' failed (%s); retrying after %.2fs",
        name,
        first_err,
        retry_backoff,
    )

    if retry_backoff > 0:
        await asyncio.sleep(retry_backoff)

    retry_err = await _attempt()
    if retry_err is None:
        logger.info("Readiness probe '%s' succeeded after retry", name)
        return None

    logger.warning("Readiness probe '%s' failed after retry: %s", name, retry_err)
    return retry_err


async def check_bigquery(client: BigQueryClientWrapper, dataset_id: str) -> None:
    """Probe BigQuery by fetching dataset metadata (lightest check available)."""
    await asyncio.to_thread(client.get_dataset, dataset_id)


async def check_postgres(session_factory: sessionmaker[Session]) -> None:
    """Probe Postgres with `SELECT 1`. Runs sync SQLAlchemy off the event loop."""

    def _probe() -> None:
        with session_factory() as session:
            session.execute(text("SELECT 1"))

    await asyncio.to_thread(_probe)


async def check_firestore(
    client: FirestoreClient, collection: str = "allowlist"
) -> None:
    """Probe Firestore by listing one document from a collection."""

    def _probe() -> None:
        list(client.collection(collection).limit(1).get())

    await asyncio.to_thread(_probe)


async def run_checks(
    probes: dict[str, Callable[[], Awaitable[None]]],
    timeout: float | None = None,  # noqa: ASYNC109 — distributes the same timeout across all probes; pushing timeout responsibility to the FastAPI handler would force the same wait_for boilerplate at every call site
    retry_backoff: float | None = None,
) -> dict[str, str | None]:
    """Run probes concurrently. Each probe gets one retry after retry_backoff.

    Retry is per-probe rather than whole-handler so a flaky BigQuery probe
    doesn't trigger a re-run of an already-successful Postgres probe.
    """
    effective_timeout = timeout if timeout is not None else DEFAULT_READINESS_TIMEOUT
    effective_backoff = (
        retry_backoff if retry_backoff is not None else DEFAULT_READINESS_RETRY_BACKOFF
    )
    names = list(probes.keys())
    results = await asyncio.gather(
        *(
            _run_with_timeout(name, probes[name], effective_timeout, effective_backoff)
            for name in names
        ),
        return_exceptions=False,
    )
    return dict(zip(names, results, strict=True))


def build_ready_response(checks: dict[str, str | None]) -> JSONResponse:
    """Assemble a /ready JSON response. 200 if all probes passed, else 503.

    `checks` maps probe name -> None (healthy) or error string (unhealthy).
    """
    failures = {name: err for name, err in checks.items() if err is not None}
    components: dict[str, Any] = {
        name: ResponseStatus.HEALTHY if err is None else "unhealthy"
        for name, err in checks.items()
    }
    if failures:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "components": components,
                "errors": failures,
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "status": ResponseStatus.HEALTHY,
            "components": components,
        },
    )
