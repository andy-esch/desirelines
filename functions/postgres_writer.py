"""Strava PostgreSQL sync - syncs Strava activities to PostgreSQL"""

# CRITICAL: Fix Python import path for Cloud Functions Gen2
# Must be FIRST executable code before any imports
import sys
if "/workspace" in sys.path:
    sys.path.remove("/workspace")
sys.path.insert(0, "/workspace")

import uuid
from typing import Any

from cloudevents.http import CloudEvent
import functions_framework
from pydantic import ValidationError

from stravapipe.application.postgres_sync import make_postgres_write_service
from stravapipe.cfutils.cloud_event import (
    CloudEventValidationError,
    MessageDecodeError,
    safe_decode_message,
    validate_cloud_event,
)
from stravapipe.cfutils.logging import setup_cloud_function_logging
from stravapipe.cfutils.responses import (
    error_response,
    skipped_response,
    success_response,
)
from stravapipe.config import load_postgres_writer_config
from stravapipe.domain import AspectType, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError

# Set up logging
logger = setup_cloud_function_logging(__name__)

# Validate configuration at module level (fail fast pattern)
# This ensures the function won't deploy if configuration is invalid,
# catching issues at deployment time rather than on first webhook.
try:
    load_postgres_writer_config()
    logger.info("PostgreSQL Writer configuration validated successfully")
except ValidationError as e:
    logger.error("PostgreSQL Writer configuration validation failed: %s", e)
    raise  # Fail function startup
except Exception as e:
    logger.error("Failed to load PostgreSQL Writer configuration: %s", e)
    raise  # Fail function startup


@functions_framework.cloud_event
def main(event: CloudEvent) -> dict:
    """Process CloudEvent and sync Strava activity to PostgreSQL"""

    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())

    # Log function invocation for debugging unacked messages
    logger.info(
        "PostgreSQL writer function invoked",
        extra={
            "correlation_id": correlation_id,
            "event_type": getattr(event, "type", "unknown"),
            "event_source": getattr(event, "source", "unknown"),
        },
    )

    try:
        # Validate CloudEvent structure
        validate_cloud_event(event)
        logger.info(
            "CloudEvent validation successful - processing message",
            extra={
                "correlation_id": correlation_id,
                "message_id": event.data.get("message", {}).get("messageId", "unknown"),
                "publish_time": event.data.get("message", {}).get(
                    "publishTime", "unknown"
                ),
            },
        )

        # Safely decode message data
        try:
            event_data = safe_decode_message(event.data["message"]["data"])
        except MessageDecodeError as e:
            logger.error(
                "Failed to decode CloudEvent message: %s",
                e,
                extra={"correlation_id": correlation_id},
            )
            return error_response("message_decode_failed", str(e), correlation_id)

        # Parse and validate webhook request
        try:
            parsed_request = WebhookRequest(**event_data)
        except ValidationError as e:
            logger.error(
                "Webhook validation failed: %s",
                str(e),
                extra={"correlation_id": correlation_id},
            )
            return error_response("validation_failed", str(e), correlation_id)

        logger.info(
            "Parsed webhook event",
            extra={"correlation_id": correlation_id, **parsed_request.model_dump()},
        )

        # Route to appropriate handler based on aspect_type
        if parsed_request.aspect_type == AspectType.CREATE:
            return _handle_create(parsed_request, correlation_id)

        elif parsed_request.aspect_type == AspectType.UPDATE:
            return _handle_update(parsed_request, correlation_id)

        elif parsed_request.aspect_type == AspectType.DELETE:
            return _handle_delete(parsed_request, correlation_id)

        else:
            logger.info(
                "Skipping unknown event type: %s",
                parsed_request.aspect_type.value,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                parsed_request.aspect_type.value,
                correlation_id,
                details="Unknown event type",
            )

    except CloudEventValidationError as e:
        logger.error(
            "Invalid CloudEvent structure: %s",
            e,
            extra={"correlation_id": correlation_id},
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise

    except Exception as e:
        logger.error(
            "Unexpected error processing CloudEvent: %s",
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise


def _handle_create(parsed_request: WebhookRequest, correlation_id: str) -> dict:
    """Handle CREATE events - insert new activity to PostgreSQL."""
    try:
        service = make_postgres_write_service()
        inserted = service.create_activity(parsed_request.object_id)

        if inserted:
            logger.info(
                "Successfully created activity %s in PostgreSQL",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return success_response(
                "created", parsed_request.object_id, correlation_id
            )
        else:
            # Duplicate CREATE event - activity already exists
            logger.warning(
                "Activity %s already exists in PostgreSQL (duplicate CREATE)",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                "already_exists", correlation_id, parsed_request.object_id
            )

    except ActivityNotFoundError:
        # Activity not found (404) - expected, don't retry
        logger.warning(
            "Activity %s not found in Strava "
            "(already deleted, never existed, or don't have access)",
            parsed_request.object_id,
            extra={
                "correlation_id": correlation_id,
                "activity_id": parsed_request.object_id,
                "error_type": "activity_not_found",
            },
        )
        return skipped_response(
            "activity_not_found", correlation_id, parsed_request.object_id
        )

    except Exception as e:
        logger.error(
            "PostgreSQL create failed for activity %s: %s",
            parsed_request.object_id,
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise


def _handle_update(parsed_request: WebhookRequest, correlation_id: str) -> dict:
    """Handle UPDATE events - update metadata or create if activity doesn't exist.

    UPDATE webhooks contain only changed fields in the 'updates' hash.
    We only care about 'title' and 'type' changes.

    If activity doesn't exist in PostgreSQL (predates our setup), we fetch
    from Strava and create it instead.
    """
    updates = parsed_request.updates or {}

    # Only process title and type changes
    relevant_updates = {k: v for k, v in updates.items() if k in ("title", "type")}

    if not relevant_updates:
        logger.info(
            "Skipping UPDATE with no relevant changes",
            extra={
                "correlation_id": correlation_id,
                "activity_id": parsed_request.object_id,
                "updates": updates,
            },
        )
        return skipped_response(
            "no_relevant_updates", correlation_id, parsed_request.object_id
        )

    try:
        service = make_postgres_write_service()

        # Check if activity exists - if not, treat as CREATE
        if not service.activity_exists(parsed_request.object_id):
            logger.info(
                "Activity %s not in PostgreSQL, fetching from Strava (backfill)",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            # Fetch from Strava and create (will have latest metadata)
            inserted = service.create_activity(parsed_request.object_id)
            if inserted:
                return success_response(
                    "created", parsed_request.object_id, correlation_id
                )
            else:
                # Race condition - another request created it
                return skipped_response(
                    "already_exists", correlation_id, parsed_request.object_id
                )

        # Activity exists - update metadata only
        updated = service.update_activity_metadata(
            parsed_request.object_id, relevant_updates
        )

        if updated:
            logger.info(
                "Successfully updated activity %s metadata in PostgreSQL",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id, "updates": relevant_updates},
            )
            return success_response(
                "updated", parsed_request.object_id, correlation_id
            )
        else:
            # Should not happen since we checked exists() above, but handle anyway
            logger.warning(
                "Activity %s disappeared between exists check and update",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                "not_found", correlation_id, parsed_request.object_id
            )

    except ActivityNotFoundError:
        # Activity not found in Strava during backfill attempt
        logger.warning(
            "Activity %s not found in Strava during UPDATE backfill",
            parsed_request.object_id,
            extra={"correlation_id": correlation_id},
        )
        return skipped_response(
            "activity_not_found", correlation_id, parsed_request.object_id
        )

    except Exception as e:
        logger.error(
            "UPDATE handling failed for activity %s: %s",
            parsed_request.object_id,
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise


def _handle_delete(parsed_request: WebhookRequest, correlation_id: str) -> dict:
    """Handle DELETE events - remove activity from PostgreSQL."""
    try:
        # Create service with fresh tokens (factory handles token refresh)
        service = make_postgres_write_service()

        # Delete activity from PostgreSQL
        deleted = service.delete_activity(parsed_request.object_id)

        if deleted:
            logger.info(
                "Successfully deleted activity %s from PostgreSQL",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return success_response(
                "deleted", parsed_request.object_id, correlation_id
            )
        else:
            # Activity wasn't in PostgreSQL - that's OK, it's idempotent
            logger.info(
                "Activity %s not found in PostgreSQL (already deleted or never synced)",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                "not_found", correlation_id, parsed_request.object_id
            )

    except Exception as e:
        logger.error(
            "Delete operation failed for activity %s: %s",
            parsed_request.object_id,
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise
