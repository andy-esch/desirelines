"""FastAPI application for PostgreSQL writer Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to PostgreSQL. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_postgres_writer_config
from stravapipe.domain.activity import StandardActivity
from stravapipe.domain.geometry import decode_polyline_to_geojson
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics, shutdown_metrics
from stravapipe.shared.responses import HealthResponse, WebhookResponse
from stravapipe.shared.tracing import record_span, setup_tracing, shutdown_tracing
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_logging(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize shared resources on startup and ensure clean shutdown."""
    try:
        config = load_postgres_writer_config()
        logger.info("PostgreSQL Writer configuration validated successfully")

        # Create session factory once at startup (connection pool)
        app.state.db_engine, app.state.session_factory = create_session_factory(
            config.postgres_connection_string
        )
        logger.info("PostgreSQL session factory initialized")

        # Initialize OTel metrics
        meter = setup_metrics("desirelines-postgres-writer")
        app.state.pg_histogram = meter.create_histogram(
            "desirelines.io/postgres/operation.duration",
            unit="ms",
            description="PostgreSQL operation duration",
        )
        app.state.webhook_counter = meter.create_counter(
            "desirelines.io/webhook/events",
            description="Webhook events processed",
        )

        # Initialize OTel tracing
        app.state.tracer = setup_tracing("desirelines-postgres-writer")

        yield
    except Exception:
        logger.exception("Application lifecycle error")
        raise
    finally:
        # Dispose the SQLAlchemy engine so connections are closed cleanly when a
        # Cloud Run revision is replaced — otherwise pooled connections leak until
        # the container is torn down.
        engine = getattr(app.state, "db_engine", None)
        if engine is not None:
            engine.dispose()
            logger.info("PostgreSQL engine disposed")

        # shutdown_metrics and shutdown_tracing are safe to call multiple times
        # and handle the case where they haven't been initialized (provider is None).
        shutdown_metrics()
        shutdown_tracing()
        logger.info("OTel resources shutdown")


app = FastAPI(
    title="PostgreSQL Writer",
    description="Syncs Strava activities to PostgreSQL via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> HealthResponse:
    """Health check endpoint for Cloud Run."""
    return HealthResponse(status=ResponseStatus.HEALTHY)


@app.post("/")
async def handle_pubsub(request: Request) -> WebhookResponse:
    """Handle Pub/Sub CloudEvent from Eventarc."""
    session_factory = request.app.state.session_factory
    pg_hist = request.app.state.pg_histogram
    webhook_counter = request.app.state.webhook_counter
    tracer = request.app.state.tracer
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event, event_data, cid, session_factory, pg_hist, tracer
        ),
        on_update=lambda event, event_data, cid: _handle_update(
            event, cid, session_factory, pg_hist, tracer
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(
            event, cid, session_factory, pg_hist, tracer
        ),
        webhook_counter=webhook_counter,
        tracer=tracer,
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle CREATE events - insert new activity to PostgreSQL.

    Activity data is provided inline from the dispatcher's enriched event.
    No Strava API call is needed.
    """
    activity_id = event.object_id
    raw_activity = event_data.get("raw_activity")

    if raw_activity is None:
        logger.warning(
            "CREATE event missing raw_activity, skipping",
            extra={"activity_id": activity_id},
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
        )

    # Construct StandardActivity from raw Strava API JSON
    activity = StandardActivity.model_validate(raw_activity)

    # Insert to PostgreSQL within transaction (no Strava API call needed)
    uow = SqlAlchemyUnitOfWork(session_factory)
    with (
        record_span(tracer, "postgres.insert", {"activity_id": activity_id}),
        record_duration(pg_histogram, {"operation": "insert"}),
        uow,
    ):
        inserted = uow.activities.insert(activity)
        if (
            inserted
            and activity.map
            and activity.map.polyline
            and (geojson := decode_polyline_to_geojson(activity.map.polyline))
        ):
            uow.activities.insert_route(activity.id, geojson)
        uow.commit()

    if inserted:
        logger.info(
            "Created activity %s in PostgreSQL",
            activity_id,
            extra={"user_id": activity.user_id},
        )
        return WebhookResponse(
            status=ResponseStatus.CREATED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    logger.warning("Activity %s already exists (duplicate CREATE)", activity_id)
    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.ALREADY_EXISTS,
    )


async def _handle_update(
    event: pb.WebhookEvent,
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle UPDATE events - update metadata if activity exists."""
    activity_id = event.object_id
    updates = event.updates

    # Extract relevant updates from typed ActivityUpdates message
    relevant_updates: dict[str, str] = {}
    if updates.HasField("title"):
        relevant_updates["title"] = updates.title
    if updates.HasField("type"):
        relevant_updates["type"] = updates.type

    if not relevant_updates:
        logger.info(
            "Skipping UPDATE with no relevant changes",
            extra={
                "activity_id": activity_id,
                "has_private_update": updates.HasField("private"),
            },
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.NO_RELEVANT_UPDATES,
        )

    uow = SqlAlchemyUnitOfWork(session_factory)
    with (
        record_span(tracer, "postgres.update_metadata", {"activity_id": activity_id}),
        record_duration(pg_histogram, {"operation": "update_metadata"}),
        uow,
    ):
        # If activity doesn't exist, skip with warning
        # (going forward, CREATEs always carry data so backfill is not needed)
        if not uow.activities.exists(activity_id):
            updated = None
        else:
            updated = uow.activities.update_metadata(activity_id, relevant_updates)
            uow.commit()

    if updated is None:
        logger.warning(
            "Activity %s not in PostgreSQL, skipping UPDATE (no backfill)",
            activity_id,
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.NOT_FOUND,
        )

    if updated:
        logger.info(
            "Updated activity %s metadata",
            activity_id,
            extra={"updates": relevant_updates},
        )
        return WebhookResponse(
            status=ResponseStatus.UPDATED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.NOT_FOUND,
    )


async def _handle_delete(
    event: pb.WebhookEvent,
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle DELETE events - remove activity from PostgreSQL."""
    activity_id = event.object_id
    uow = SqlAlchemyUnitOfWork(session_factory)

    with (
        record_span(tracer, "postgres.delete", {"activity_id": activity_id}),
        record_duration(pg_histogram, {"operation": "delete"}),
        uow,
    ):
        deleted = uow.activities.delete(activity_id)
        uow.commit()

    if deleted:
        logger.info("Deleted activity %s from PostgreSQL", activity_id)
        return WebhookResponse(
            status=ResponseStatus.DELETED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    logger.info(
        "Activity %s not found in PostgreSQL (already deleted or never synced)",
        activity_id,
    )
    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.NOT_FOUND,
    )
