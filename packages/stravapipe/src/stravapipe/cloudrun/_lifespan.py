"""Shared Cloud Run lifespan teardown.

`postgres_writer_app` and `deletion_service_app` had byte-identical `finally:`
blocks in their lifespan handlers. Any third postgres-backed service would have
copied them a third time — and the failure mode of getting it wrong (a leaked
connection pool across a revision swap) is invisible until Neon runs out of
connections.
"""

import logging

from fastapi import FastAPI

from stravapipe.shared.tracing import shutdown_otel

logger = logging.getLogger(__name__)


def shutdown_app_resources(app: FastAPI) -> None:
    """Release shared resources on Cloud Run shutdown.

    Safe to call when startup failed part-way: the engine is read with
    ``getattr`` because ``app.state.db_engine`` may never have been set, and
    ``shutdown_otel`` guards each provider independently.

    Call from the ``finally:`` of a lifespan handler so it runs on both clean
    shutdown and startup failure.
    """
    # Dispose the SQLAlchemy engine so connections are closed cleanly when a
    # Cloud Run revision is replaced — otherwise pooled connections leak until
    # the container is torn down.
    engine = getattr(app.state, "db_engine", None)
    if engine is not None:
        engine.dispose()
        logger.info("PostgreSQL engine disposed")

    # shutdown_otel guards each provider shutdown independently (and is safe
    # to call when a provider was never initialized) and logs completion.
    shutdown_otel()
