"""FastAPI application for BigQuery inserter Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to BigQuery. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp import make_bigquery_client_wrapper, make_write_activities
from stravapipe.application.bq_inserter import (
    DeleteActivityService,
    make_delete_service,
)
from stravapipe.cloudrun.errors import validate_or_422
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_bq_inserter_config
from stravapipe.domain.activity import DetailedStravaActivity
from stravapipe.ports.out.write import WriteActivities
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics, shutdown_metrics
from stravapipe.shared.readiness import (
    build_ready_response,
    check_bigquery,
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
        config = load_bq_inserter_config()
        logger.info("BQ Inserter configuration validated successfully")

        app.state.writer = make_write_activities(config)
        logger.info("BigQuery writer initialized")

        app.state.delete_service = make_delete_service(config)
        logger.info("BigQuery delete service initialized")

        # Held for /ready dependency probe (get_dataset on the configured dataset).
        app.state.bq_client = make_bigquery_client_wrapper(config)
        app.state.bq_dataset = config.bq_dataset

        app.state.readiness_timeout_s = config.readiness_timeout_s

        # Initialize OTel metrics
        meter = setup_metrics("desirelines-bq-inserter")
        app.state.bq_histogram = meter.create_histogram(
            "desirelines.io/bigquery/operation.duration",
            unit="ms",
            description="BigQuery operation duration",
        )
        app.state.webhook_counter = meter.create_counter(
            "desirelines.io/webhook/events",
            description="Webhook events processed",
        )

        # Initialize OTel tracing
        app.state.tracer = setup_tracing("desirelines-bq-inserter")

        yield
    except Exception:
        logger.exception("Application lifecycle error")
        raise
    finally:
        # shutdown_metrics and shutdown_tracing are safe to call multiple times
        # and handle the case where they haven't been initialized (provider is None).
        shutdown_metrics()
        shutdown_tracing()
        logger.info("OTel resources shutdown")


app = FastAPI(
    title="BigQuery Inserter",
    description="Syncs Strava activities to BigQuery via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> HealthResponse:
    """Liveness probe — process-alive only, no dependency checks."""
    return HealthResponse(status=ResponseStatus.HEALTHY)


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness probe — verifies BigQuery is reachable. Hit hourly by Cloud Scheduler."""
    bq_client = request.app.state.bq_client
    dataset_id = request.app.state.bq_dataset
    checks = await run_checks(
        {"bigquery": lambda: check_bigquery(bq_client, dataset_id)},
        timeout=request.app.state.readiness_timeout_s,
    )
    return build_ready_response(checks)


@app.post("/")
async def handle_pubsub(request: Request) -> WebhookResponse:
    """Handle Pub/Sub CloudEvent from Eventarc."""
    writer = request.app.state.writer
    delete_service = request.app.state.delete_service
    bq_hist = request.app.state.bq_histogram
    webhook_counter = request.app.state.webhook_counter
    tracer = request.app.state.tracer
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event, event_data, cid, writer, bq_hist, tracer
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(
            event, cid, delete_service, bq_hist, tracer
        ),
        webhook_counter=webhook_counter,
        tracer=tracer,
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    writer: WriteActivities,
    bq_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle CREATE events - write activity to BigQuery.

    Activity data is provided inline from the dispatcher's enriched event.
    No Strava API call is needed.
    """
    raw_activity = event_data.get("raw_activity")

    if raw_activity is None:
        logger.warning(
            "CREATE event missing raw_activity, skipping",
            extra={"activity_id": event.object_id},
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
            activity_id=event.object_id,
            correlation_id=correlation_id,
        )

    # Construct DetailedStravaActivity from raw Strava API JSON.
    # ValidationError → 422 so Pub/Sub acks immediately; retrying a
    # malformed payload will fail identically.
    activity = validate_or_422(
        DetailedStravaActivity, raw_activity, context="raw_activity"
    )

    with (
        record_span(tracer, "bigquery.insert_rows", {"activity_id": event.object_id}),
        record_duration(bq_histogram, {"operation": "insert_rows"}),
    ):
        stats = writer.write_activity(activity)

    logger.info(
        "Activity upserted to BigQuery",
        extra={
            "activity_id": event.object_id,
            "rows_affected": stats.get("rows_affected", 0),
            "execution_time_ms": stats.get("execution_time_ms"),
        },
    )
    return WebhookResponse(
        status=ResponseStatus.CREATED,
        activity_id=event.object_id,
        correlation_id=correlation_id,
    )


async def _handle_delete(
    event: pb.WebhookEvent,
    correlation_id: str,
    service: DeleteActivityService,
    bq_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle DELETE events - archive and remove from BigQuery."""
    with (
        record_span(tracer, "bigquery.dml", {"activity_id": event.object_id}),
        record_duration(bq_histogram, {"operation": "dml"}),
    ):
        result = service.run(
            activity_id=event.object_id,
            correlation_id=correlation_id,
            event_time=event.event_time,
        )

    if result.rows_archived == 0:
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
            activity_id=result.activity_id,
            correlation_id=correlation_id,
        )

    return WebhookResponse(
        status=ResponseStatus.PROCESSED,
        action=ResponseStatus.DELETED,
        activity_id=result.activity_id,
        correlation_id=correlation_id,
    )
