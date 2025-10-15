"""Strava BigQuery sync - syncs Strava activities to BigQuery"""

import uuid

from cloudevents.http import CloudEvent
import functions_framework
from pydantic import ValidationError

from stravapipe.application.bq_inserter import make_delete_service, make_sync_service
from stravapipe.cfutils.cloud_event import (
    CloudEventValidationError,
    MessageDecodeError,
    safe_decode_message,
    setup_cloud_function_logging,
    validate_cloud_event,
)
from stravapipe.cfutils.responses import (
    error_response,
    skipped_response,
    success_response,
)
from stravapipe.config import load_bq_inserter_config
from stravapipe.domain import AspectType, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError

# Set up logging
logger = setup_cloud_function_logging(__name__)

# Validate configuration at module level (fail fast pattern)
# This ensures the function won't deploy if configuration is invalid,
# catching issues at deployment time rather than on first webhook.
# The services (make_sync_service, make_delete_service) will reload
# config when needed, so we don't store the result here.
try:
    load_bq_inserter_config()
    logger.info("BQ Inserter configuration validated successfully")
except ValidationError as e:
    logger.error("BQ Inserter configuration validation failed: %s", e)
    raise  # Fail function startup - better to catch config errors at deploy time
except Exception as e:
    logger.error("Failed to load BQ Inserter configuration: %s", e)
    raise  # Fail function startup - better to catch config errors at deploy time


@functions_framework.cloud_event
def main(event: CloudEvent) -> dict:
    """Process CloudEvent and sync Strava activity to BigQuery"""

    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())

    # Log function invocation for debugging unacked messages
    logger.info(
        "BQ inserter function invoked",
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
            # Handle create events
            try:
                # Initialize sync service
                usecase = make_sync_service()

                # Insert activity into BigQuery
                usecase.run(parsed_request.object_id)
                logger.info(
                    "Successfully synced activity %s to BigQuery",
                    parsed_request.object_id,
                    extra={"correlation_id": correlation_id},
                )
                return success_response(
                    "created", parsed_request.object_id, correlation_id
                )
            except ActivityNotFoundError:
                # Activity not found (404)
                # This is expected and should not trigger retry or DLQ
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
                    "BigQuery sync failed for activity %s: %s",
                    parsed_request.object_id,
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

        elif parsed_request.aspect_type == AspectType.DELETE:
            # Handle delete events
            logger.info(
                "Processing delete event for activity %s",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            try:
                # Initialize delete service
                delete_service = make_delete_service()

                # Archive and delete activity
                result = delete_service.run(
                    activity_id=parsed_request.object_id,
                    correlation_id=correlation_id,
                    event_time=parsed_request.event_time,
                )
                return result
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

        else:
            # Skip update events (AspectType.UPDATE - not implemented yet)
            logger.info(
                "Skipping event type: %s",
                parsed_request.aspect_type.value,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                parsed_request.aspect_type.value,
                correlation_id,
                details="Event type not implemented",
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
