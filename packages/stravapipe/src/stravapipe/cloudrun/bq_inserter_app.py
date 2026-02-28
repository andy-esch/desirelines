"""FastAPI application for BigQuery inserter Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to BigQuery. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from opentelemetry.metrics import Histogram

from stravapipe.adapters.gcp import make_write_activities
from stravapipe.application.bq_inserter import make_delete_service
from stravapipe.cfutils.constants import (
    ResponseField,
    ResponseStatus,
    SkipReason,
)
from stravapipe.cfutils.logging import setup_logging
from stravapipe.cfutils.metrics import record_duration, setup_metrics
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_bq_inserter_config
from stravapipe.domain.activity import DetailedStravaActivity
from stravapipe.ports.out.write import WriteActivities
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_logging(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize shared resources on startup."""
    try:
        config = load_bq_inserter_config()
        logger.info("BQ Inserter configuration validated successfully")

        app.state.writer = make_write_activities(config)
        logger.info("BigQuery writer initialized")

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
    except Exception as e:
        logger.error("Startup initialization failed: %s", e)
        raise
    yield


app = FastAPI(
    title="BigQuery Inserter",
    description="Syncs Strava activities to BigQuery via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check endpoint for Cloud Run."""
    return {ResponseField.STATUS: ResponseStatus.HEALTHY}


@app.post("/")
async def handle_pubsub(request: Request):
    """Handle Pub/Sub CloudEvent from Eventarc."""
    writer = request.app.state.writer
    bq_hist = request.app.state.bq_histogram
    webhook_counter = request.app.state.webhook_counter
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event, event_data, cid, writer, bq_hist
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(event, cid, bq_hist),
        webhook_counter=webhook_counter,
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    writer: WriteActivities,
    bq_histogram: Histogram | None = None,
) -> dict:
    """Handle CREATE events - write activity to BigQuery.

    Activity data is provided inline from the dispatcher's enriched event.
    No Strava API call is needed.
    """
    raw_activity = event_data.get("raw_activity")

    if raw_activity is None:
        logger.warning(
            "CREATE event missing raw_activity, skipping",
            extra={
                "correlation_id": correlation_id,
                "activity_id": event.object_id,
            },
        )
        return {
            ResponseField.STATUS: ResponseStatus.SKIPPED,
            ResponseField.REASON: SkipReason.ACTIVITY_NOT_FOUND,
            ResponseField.ACTIVITY_ID: event.object_id,
            ResponseField.CORRELATION_ID: correlation_id,
        }

    # Construct DetailedStravaActivity from raw Strava API JSON
    activity = DetailedStravaActivity.model_validate(raw_activity)

    if bq_histogram is not None:
        with record_duration(bq_histogram, {"operation": "insert_rows"}):
            stats = writer.write_activity(activity)
    else:
        stats = writer.write_activity(activity)

    logger.info(
        "Activity upserted to BigQuery",
        extra={
            "correlation_id": correlation_id,
            "activity_id": event.object_id,
            "rows_affected": stats.get("rows_affected", 0),
            "execution_time_ms": stats.get("execution_time_ms"),
        },
    )
    return {
        ResponseField.STATUS: ResponseStatus.CREATED,
        ResponseField.ACTIVITY_ID: event.object_id,
        ResponseField.CORRELATION_ID: correlation_id,
    }


async def _handle_delete(
    event: pb.WebhookEvent,
    correlation_id: str,
    bq_histogram: Histogram | None = None,
) -> dict:
    """Handle DELETE events - archive and remove from BigQuery."""
    logger.info(
        "Processing delete event for activity %s",
        event.object_id,
        extra={"correlation_id": correlation_id},
    )

    service = make_delete_service()

    if bq_histogram is not None:
        with record_duration(bq_histogram, {"operation": "dml"}):
            result = service.run(
                activity_id=event.object_id,
                correlation_id=correlation_id,
                event_time=event.event_time,
            )
    else:
        result = service.run(
            activity_id=event.object_id,
            correlation_id=correlation_id,
            event_time=event.event_time,
        )

    return result
