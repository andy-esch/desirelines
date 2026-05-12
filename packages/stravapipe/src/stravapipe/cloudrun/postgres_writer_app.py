"""FastAPI application for PostgreSQL writer Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to PostgreSQL. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.cloudrun.errors import validate_or_422
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_postgres_writer_config
from stravapipe.domain.activity import StandardActivity
from stravapipe.domain.geometry import decode_polyline_to_geojson
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.correlation import get_dispatcher_received_at_ms
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics, shutdown_metrics
from stravapipe.shared.readiness import (
    build_ready_response,
    check_postgres,
    run_checks,
)
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

        app.state.readiness_timeout = config.readiness_timeout

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
        # End-to-end webhook freshness: time from dispatcher receiving the
        # Strava webhook to the activity row landing in postgres. Anchors
        # SLO 3 (data freshness). The dispatcher stamps a
        # `dispatcher_received_at_unix_ms` Pub/Sub attribute on every
        # message; we read it here and record `now() - received_at` after
        # a successful insert. Lost events (DLQ) don't emit a measurement,
        # so they count against the SLO via its denominator.
        app.state.freshness_histogram = meter.create_histogram(
            "desirelines.io/webhook/end_to_end.duration",
            unit="ms",
            description=(
                "End-to-end webhook latency from dispatcher receive to "
                "the postgres state reflecting the change. Records on "
                "success paths only: new row inserted (CREATE), metadata "
                "updated (UPDATE), row deleted (DELETE). Skips and DLQ "
                "events don't emit; the latter are covered by SLO 2 "
                "(webhook ingest success)."
            ),
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
    """Liveness probe — process-alive only, no dependency checks."""
    return HealthResponse(status=ResponseStatus.HEALTHY)


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness probe — verifies Postgres is reachable. Hit hourly by Cloud Scheduler.

    Avoid wiring this to high-frequency Cloud Run probes: Neon bills compute
    by the hour, so each ping wakes the database.
    """
    session_factory = request.app.state.session_factory
    checks = await run_checks(
        {"postgres": lambda: check_postgres(session_factory)},
        timeout=request.app.state.readiness_timeout,
    )
    return build_ready_response(checks)


@app.post("/")
async def handle_pubsub(request: Request) -> WebhookResponse:
    """Handle Pub/Sub CloudEvent from Eventarc."""
    session_factory = request.app.state.session_factory
    pg_hist = request.app.state.pg_histogram
    freshness_hist = request.app.state.freshness_histogram
    webhook_counter = request.app.state.webhook_counter
    tracer = request.app.state.tracer
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event, event_data, cid, session_factory, pg_hist, tracer, freshness_hist
        ),
        on_update=lambda event, event_data, cid: _handle_update(
            event, cid, session_factory, pg_hist, tracer, freshness_hist
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(
            event, cid, session_factory, pg_hist, tracer, freshness_hist
        ),
        webhook_counter=webhook_counter,
        tracer=tracer,
        # Service-prefixed so this doesn't collide with the bq-inserter's
        # span on the same Pub/Sub event in Cloud Trace's compact view.
        span_name="postgres_writer.webhook.process",
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
    freshness_histogram: Histogram | None = None,
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

    # Construct StandardActivity from raw Strava API JSON.
    # ValidationError → 422 so Pub/Sub acks immediately; retrying a
    # malformed payload will fail identically.
    activity = validate_or_422(StandardActivity, raw_activity, context="raw_activity")

    # Insert to PostgreSQL within transaction (no Strava API call needed).
    # The UoW emits postgres.session.acquire and postgres.commit sub-spans
    # internally; the call-site sub-spans below cover the work in between
    # so a trace shows insert / polyline-decode / route-insert / commit
    # latency separately. Polyline decode is pure CPU and dominates for
    # long routes, which is why it gets its own span.
    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)
    with (
        record_span(tracer, "postgres.insert", {"activity_id": activity_id}),
        record_duration(pg_histogram, {"operation": "insert"}),
        uow,
    ):
        # Sub-operation histogram: postgres.activities.insert is the single
        # slowest postgres-side step on warm Neon (the Neon cold-compute
        # signal lands here, not on session.acquire which is just TCP).
        # Recording on the same `postgres/operation.duration` histogram with
        # a sub-operation label lets the SLO task alert on it independently.
        with (
            record_span(
                tracer,
                "postgres.activities.insert",
                {"activity_id": activity_id},
            ),
            record_duration(pg_histogram, {"operation": "activities_insert"}),
        ):
            inserted = uow.activities.insert(activity)

        if inserted and activity.map and activity.map.polyline:
            with record_span(
                tracer,
                "postgres.polyline.decode",
                {"activity_id": activity_id},
            ):
                geojson = decode_polyline_to_geojson(activity.map.polyline)
            if geojson:
                with record_span(
                    tracer,
                    "postgres.activities.insert_route",
                    {"activity_id": activity_id},
                ):
                    uow.activities.insert_route(activity.id, geojson)

        uow.commit()

    if inserted:
        # Record end-to-end webhook freshness (anchors SLO 3). Skipped when
        # the dispatcher didn't stamp the timestamp (legacy messages from
        # before the attribute existed) — that's fine, the SLO measures
        # against post-rollout traffic only.
        received_at_ms = get_dispatcher_received_at_ms()
        if received_at_ms is not None and freshness_histogram is not None:
            elapsed_ms = (time.time() * 1000.0) - received_at_ms
            freshness_histogram.record(elapsed_ms, {"aspect_type": "create"})

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
    freshness_histogram: Histogram | None = None,
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

    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)
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
        # Record end-to-end webhook freshness for the UPDATE path. Mirrors
        # the CREATE-side emission; same SLO 3 measurement, different
        # aspect_type label so per-path slicing stays available in
        # Metrics Explorer if behavior diverges.
        received_at_ms = get_dispatcher_received_at_ms()
        if received_at_ms is not None and freshness_histogram is not None:
            elapsed_ms = (time.time() * 1000.0) - received_at_ms
            freshness_histogram.record(elapsed_ms, {"aspect_type": "update"})

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
    freshness_histogram: Histogram | None = None,
) -> WebhookResponse:
    """Handle DELETE events - remove activity from PostgreSQL."""
    activity_id = event.object_id
    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)

    with (
        record_span(tracer, "postgres.delete", {"activity_id": activity_id}),
        record_duration(pg_histogram, {"operation": "delete"}),
        uow,
    ):
        deleted = uow.activities.delete(activity_id)
        uow.commit()

    if deleted:
        # Record end-to-end webhook freshness for the DELETE path. The
        # interesting variant of "freshness" for delete is "how long
        # before the ghost activity disappears from the dashboard."
        # Mirrors the CREATE/UPDATE shape; same SLO 3 measurement, just
        # a different aspect_type label.
        received_at_ms = get_dispatcher_received_at_ms()
        if received_at_ms is not None and freshness_histogram is not None:
            elapsed_ms = (time.time() * 1000.0) - received_at_ms
            freshness_histogram.record(elapsed_ms, {"aspect_type": "delete"})

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
