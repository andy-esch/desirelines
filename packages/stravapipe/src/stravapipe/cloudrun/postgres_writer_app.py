"""FastAPI application for PostgreSQL writer Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to PostgreSQL. It acts as a thin controller,
delegating business logic to the existing application services.
"""

from contextlib import asynccontextmanager
import uuid

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from stravapipe.application.postgres_sync import make_postgres_write_service
from stravapipe.cfutils.logging import setup_cloud_function_logging
from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent
from stravapipe.config import load_postgres_writer_config
from stravapipe.domain import AspectType, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError

logger = setup_cloud_function_logging(__name__)


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

        # Validate webhook request
        try:
            parsed_request = WebhookRequest(**event_data)
        except ValidationError as err:
            logger.error(
                "Webhook validation failed: %s",
                err,
                extra={"correlation_id": correlation_id},
            )
            raise HTTPException(
                status_code=422, detail=f"Invalid webhook: {err}"
            ) from err

        logger.info(
            "Processing webhook",
            extra={"correlation_id": correlation_id, **parsed_request.model_dump()},
        )

        # Route by aspect type
        if parsed_request.aspect_type == AspectType.CREATE:
            return await _handle_create(parsed_request, correlation_id)
        elif parsed_request.aspect_type == AspectType.UPDATE:
            return await _handle_update(parsed_request, correlation_id)
        elif parsed_request.aspect_type == AspectType.DELETE:
            return await _handle_delete(parsed_request, correlation_id)
        else:
            logger.info(
                "Skipping unknown aspect type: %s",
                parsed_request.aspect_type,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "skipped",
                "reason": "unknown_aspect_type",
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


async def _handle_create(request: WebhookRequest, correlation_id: str) -> dict:
    """Handle CREATE events - insert new activity to PostgreSQL."""
    try:
        service = make_postgres_write_service()
        inserted = service.create_activity(request.object_id)

        if inserted:
            logger.info(
                "Created activity %s in PostgreSQL",
                request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "created",
                "activity_id": request.object_id,
                "correlation_id": correlation_id,
            }
        else:
            logger.warning(
                "Activity %s already exists (duplicate CREATE)",
                request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "skipped",
                "reason": "already_exists",
                "activity_id": request.object_id,
                "correlation_id": correlation_id,
            }

    except ActivityNotFoundError:
        logger.warning(
            "Activity %s not found in Strava",
            request.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "skipped",
            "reason": "activity_not_found",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }


async def _handle_update(request: WebhookRequest, correlation_id: str) -> dict:
    """Handle UPDATE events - update metadata or backfill if missing."""
    updates = request.updates or {}
    relevant_updates = {k: v for k, v in updates.items() if k in ("title", "type")}

    if not relevant_updates:
        logger.info(
            "Skipping UPDATE with no relevant changes",
            extra={
                "correlation_id": correlation_id,
                "activity_id": request.object_id,
                "updates": updates,
            },
        )
        return {
            "status": "skipped",
            "reason": "no_relevant_updates",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }

    try:
        service = make_postgres_write_service()

        # Check if activity exists - if not, treat as CREATE (backfill)
        if not service.activity_exists(request.object_id):
            logger.info(
                "Activity %s not in PostgreSQL, backfilling from Strava",
                request.object_id,
                extra={"correlation_id": correlation_id},
            )
            inserted = service.create_activity(request.object_id)
            if inserted:
                return {
                    "status": "created",
                    "activity_id": request.object_id,
                    "correlation_id": correlation_id,
                }
            return {
                "status": "skipped",
                "reason": "already_exists",
                "activity_id": request.object_id,
                "correlation_id": correlation_id,
            }

        # Activity exists - update metadata only
        updated = service.update_activity_metadata(request.object_id, relevant_updates)

        if updated:
            logger.info(
                "Updated activity %s metadata",
                request.object_id,
                extra={"correlation_id": correlation_id, "updates": relevant_updates},
            )
            return {
                "status": "updated",
                "activity_id": request.object_id,
                "correlation_id": correlation_id,
            }
        return {
            "status": "skipped",
            "reason": "not_found",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }

    except ActivityNotFoundError:
        logger.warning(
            "Activity %s not found in Strava during backfill",
            request.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "skipped",
            "reason": "activity_not_found",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }


async def _handle_delete(request: WebhookRequest, correlation_id: str) -> dict:
    """Handle DELETE events - remove activity from PostgreSQL."""
    service = make_postgres_write_service()
    deleted = service.delete_activity(request.object_id)

    if deleted:
        logger.info(
            "Deleted activity %s from PostgreSQL",
            request.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "deleted",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }
    else:
        logger.info(
            "Activity %s not found in PostgreSQL (already deleted or never synced)",
            request.object_id,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "skipped",
            "reason": "not_found",
            "activity_id": request.object_id,
            "correlation_id": correlation_id,
        }
