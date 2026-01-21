"""FastAPI application for PostgreSQL writer Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to PostgreSQL. It acts as a thin controller,
delegating business logic to the existing application services.
"""

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request

from stravapipe.adapters.proto import dict_to_webhook_event
from stravapipe.application.postgres_sync import make_postgres_write_service
from stravapipe.cfutils.constants import (
    DEFAULT_UNKNOWN,
    ResponseField,
    ResponseStatus,
    SkipReason,
    WebhookField,
)
from stravapipe.cfutils.logging import setup_cloud_function_logging
from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent
from stravapipe.config import load_postgres_writer_config
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_cloud_function_logging(__name__)


# =============================================================================
# Response Helpers
# =============================================================================


def _response(
    status: str,
    activity_id: int,
    correlation_id: str,
    reason: str | None = None,
) -> dict:
    """Build a standard webhook response dict."""
    resp = {
        ResponseField.STATUS: status,
        ResponseField.ACTIVITY_ID: activity_id,
        ResponseField.CORRELATION_ID: correlation_id,
    }
    if reason:
        resp[ResponseField.REASON] = reason
    return resp


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate configuration on startup."""
    try:
        load_postgres_writer_config()
        logger.info("PostgreSQL Writer configuration validated successfully")
    except Exception as e:
        logger.error("Configuration validation failed: %s", e)
        raise
    yield


app = FastAPI(
    title="PostgreSQL Writer",
    description="Syncs Strava activities to PostgreSQL via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check endpoint for Cloud Run."""
    return {ResponseField.STATUS: ResponseStatus.HEALTHY}


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
        aspect_name = event_data.get(WebhookField.ASPECT_TYPE, DEFAULT_UNKNOWN)

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
        elif event.aspect_type == pb.ASPECT_TYPE_UPDATE:
            return await _handle_update(event, correlation_id)
        elif event.aspect_type == pb.ASPECT_TYPE_DELETE:
            return await _handle_delete(event, correlation_id)
        else:
            logger.info(
                "Skipping unknown aspect type: %s",
                aspect_name,
                extra={"correlation_id": correlation_id},
            )
            return {
                ResponseField.STATUS: ResponseStatus.SKIPPED,
                ResponseField.REASON: SkipReason.UNKNOWN_ASPECT_TYPE,
                ResponseField.CORRELATION_ID: correlation_id,
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
    """Handle CREATE events - insert new activity to PostgreSQL."""
    activity_id = event.object_id

    try:
        service = make_postgres_write_service()
        inserted = service.create_activity(activity_id)
    except ActivityNotFoundError:
        logger.warning(
            "Activity %s not found in Strava",
            activity_id,
            extra={"correlation_id": correlation_id},
        )
        return _response(
            ResponseStatus.SKIPPED, activity_id, correlation_id,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
        )

    if inserted:
        logger.info(
            "Created activity %s in PostgreSQL",
            activity_id,
            extra={"correlation_id": correlation_id},
        )
        return _response(ResponseStatus.CREATED, activity_id, correlation_id)

    logger.warning(
        "Activity %s already exists (duplicate CREATE)",
        activity_id,
        extra={"correlation_id": correlation_id},
    )
    return _response(
        ResponseStatus.SKIPPED, activity_id, correlation_id,
        reason=SkipReason.ALREADY_EXISTS,
    )


async def _handle_update(event: pb.WebhookEvent, correlation_id: str) -> dict:
    """Handle UPDATE events - update metadata or backfill if missing."""
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
                "correlation_id": correlation_id,
                "activity_id": activity_id,
                "has_private_update": updates.HasField("private"),
            },
        )
        return _response(
            ResponseStatus.SKIPPED, activity_id, correlation_id,
            reason=SkipReason.NO_RELEVANT_UPDATES,
        )

    service = make_postgres_write_service()

    # If activity doesn't exist, delegate to CREATE handler (backfill)
    if not service.activity_exists(activity_id):
        logger.info(
            "Activity %s not in PostgreSQL, backfilling from Strava",
            activity_id,
            extra={"correlation_id": correlation_id},
        )
        return await _handle_create(event, correlation_id)

    # Activity exists - update metadata only
    try:
        updated = service.update_activity_metadata(activity_id, relevant_updates)
    except ActivityNotFoundError:
        # Race condition: activity was deleted between exists check and update
        logger.warning(
            "Activity %s not found in Strava during update",
            activity_id,
            extra={"correlation_id": correlation_id},
        )
        return _response(
            ResponseStatus.SKIPPED, activity_id, correlation_id,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
        )

    if updated:
        logger.info(
            "Updated activity %s metadata",
            activity_id,
            extra={"correlation_id": correlation_id, "updates": relevant_updates},
        )
        return _response(ResponseStatus.UPDATED, activity_id, correlation_id)

    return _response(
        ResponseStatus.SKIPPED, activity_id, correlation_id,
        reason=SkipReason.NOT_FOUND,
    )


async def _handle_delete(event: pb.WebhookEvent, correlation_id: str) -> dict:
    """Handle DELETE events - remove activity from PostgreSQL."""
    activity_id = event.object_id
    service = make_postgres_write_service()
    deleted = service.delete_activity(activity_id)

    if deleted:
        logger.info(
            "Deleted activity %s from PostgreSQL",
            activity_id,
            extra={"correlation_id": correlation_id},
        )
        return _response(ResponseStatus.DELETED, activity_id, correlation_id)

    logger.info(
        "Activity %s not found in PostgreSQL (already deleted or never synced)",
        activity_id,
        extra={"correlation_id": correlation_id},
    )
    return _response(
        ResponseStatus.SKIPPED, activity_id, correlation_id,
        reason=SkipReason.NOT_FOUND,
    )
