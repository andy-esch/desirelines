"""Readiness probe helpers for Cloud Run services.

Mirrors the apigateway pattern (packages/apigateway/internal/health/handler.go):
each service exposes a cheap /health for liveness and a deeper /ready that
exercises its primary dependency. /ready is hit hourly by Cloud Scheduler,
not on every Cloud Run probe — keep the underlying probes light to respect
that contract (see Neon compute-cost note in CLAUDE.md).
"""

import asyncio
from collections.abc import Awaitable, Callable
import logging
from typing import Any

from fastapi.responses import JSONResponse
from google.cloud.firestore_v1 import Client as FirestoreClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.shared.constants import ResponseStatus

logger = logging.getLogger(__name__)

DEFAULT_READINESS_TIMEOUT_S: float = 2.0


async def _run_with_timeout(
    name: str,
    probe: Callable[[], Awaitable[None]],
    timeout: float,  # noqa: ASYNC109 — applying the timeout is the function's whole job; rule's "use asyncio.timeout at call site" guidance would just spread the same code across every readiness handler
) -> str | None:
    """Run a probe coroutine with a timeout. None on success, error string on failure."""
    try:
        await asyncio.wait_for(probe(), timeout=timeout)
    except TimeoutError:
        logger.warning("Readiness probe '%s' timed out after %.1fs", name, timeout)
        return f"{name}: timeout"
    except Exception as exc:
        logger.warning("Readiness probe '%s' failed: %s", name, exc)
        return f"{name}: {exc}"
    return None


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
) -> dict[str, str | None]:
    """Run probes concurrently with the same timeout. Returns name -> error|None."""
    effective_timeout = (
        timeout if timeout is not None else DEFAULT_READINESS_TIMEOUT_S
    )
    names = list(probes.keys())
    results = await asyncio.gather(
        *(
            _run_with_timeout(name, probes[name], effective_timeout)
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
