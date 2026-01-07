"""FastAPI application for BigQuery inserter Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to BigQuery. It acts as a thin controller,
delegating business logic to the existing application services.
"""

from contextlib import asynccontextmanager
import uuid

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from stravapipe.adapters.proto import dict_to_webhook_event
from stravapipe.application.bq_inserter import make_sync_service, make_delete_service
from stravapipe.cfutils.logging import setup_cloud_function_logging
from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent
from stravapipe.config import load_bq_inserter_config
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_cloud_function_logging(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate configuration on startup."""
    try:
        load_bq_inserter_config()
        logger.info("BQ Inserter configuration validated successfully")
    except Exception as e:
        logger.error("Configuration validation failed: %s", e)
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
    return {"status": "healthy"}


@app.post("/")
async def handle_pubsub(request: Request):
    """Handle Pub/Sub CloudEvent from Eventarc.

    Parses the CloudEvent, validates the webhook request, and routes
    to the appropriate handler based on aspect_type.

    Returns:
        dict with status and details

    Raises:
        HTTPException: On parsing/validation errors (4xx)
        Re-raises other exceptions to trigger Pub/Sub retry (5xx)
    """
    correlation_id = str(uuid.uuid4())

    try:
        # Parse CloudEvent from HTTP request
        context, event_data = await parse_pubsub_cloudevent(request)

        logger.info(
            "Received CloudEvent",
            extra={
                "correlation_id": correlation_id,
                "event_type": context.event_type,
                "event_id": context.event_id,
            },
        )

        # Validate and parse webhook event using proto adapter
        try:
            event = dict_to_webhook_event(event_data)
        except ValueError as err:
            logger.error(
                "Webhook parsing failed: %s",
                err,
                extra={"correlation_id": correlation_id},
            )
            raise HTTPException(
                status_code=422, detail=f"Invalid webhook: {err}"
            ) from err

        # We only handle activity webhooks
        if event.object_type != pb.OBJECT_TYPE_ACTIVITY:
            obj_name = pb.ObjectType.Name(event.object_type)
            logger.info(
                "Skipping non-activity webhook",
                extra={
                    "correlation_id": correlation_id,
                    "object_type": obj_name,
                },
            )
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported object_type: {obj_name}. Only 'activity' is supported",
            )

        # Get Strava string names for logging and response
        aspect_name = event_data.get("aspect_type", "unknown")

        logger.info(
            "Processing webhook",
            extra={
                "correlation_id": correlation_id,
                "aspect_type": aspect_name,
                "object_type": "activity",
                "object_id": event.object_id,
            },
        )

        # Route by aspect type
        if event.aspect_type == pb.ASPECT_TYPE_CREATE:
            return await _handle_create(event, correlation_id)
        elif event.aspect_type == pb.ASPECT_TYPE_DELETE:
            return await _handle_delete(event, correlation_id)
        else:
            # Skip UPDATE events (not implemented for BQ inserter)
            logger.info(
                "Skipping event type: %s",
                aspect_name,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "skipped",
                "reason": aspect_name,
                "details": "Event type not implemented",
                "correlation_id": correlation_id,
            }

    except HTTPException:
        raise
    except Exception as err:
        logger.error(
            "Unexpected error: %s",
            err,
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Return 500 to trigger Pub/Sub retry
        raise HTTPException(status_code=500, detail=str(err)) from err


async def _handle_create(event: pb.WebhookEvent, correlation_id: str) -> dict:
    """Handle CREATE events - sync activity to BigQuery."""
    try:
        service = make_sync_service()
        service.run(event.object_id)

        logger.info(
            "Synced activity %s to BigQuery",
            event.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "created",
            "activity_id": event.object_id,
            "correlation_id": correlation_id,
        }

    except ActivityNotFoundError:
        logger.warning(
            "Activity %s not found in Strava",
            event.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "skipped",
            "reason": "activity_not_found",
            "activity_id": event.object_id,
            "correlation_id": correlation_id,
        }


async def _handle_delete(event: pb.WebhookEvent, correlation_id: str) -> dict:
    """Handle DELETE events - archive and remove from BigQuery."""
    logger.info(
        "Processing delete event for activity %s",
        event.object_id,
        extra={"correlation_id": correlation_id},
    )

    service = make_delete_service()
    result = service.run(
        activity_id=event.object_id,
        correlation_id=correlation_id,
        event_time=event.event_time,
    )

    return result
