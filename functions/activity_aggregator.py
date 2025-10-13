"""Desire Lines listener - builds JSON documents that are consumed by the desire lines
web app"""

import base64
import binascii
import json
import logging
import uuid

from cloudevents.http import CloudEvent
import functions_framework
from pydantic import ValidationError

from stravapipe.application.aggregator.usecases import (
    make_delete_summary_use_case,
    make_update_summary_use_case,
)
from stravapipe.domain import AspectType, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError

# Configure logging for Google Cloud Functions
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)

# Set up Cloud Functions compatible logging
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter("%(levelname)s:%(name)s:%(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class MessageDecodeError(Exception):
    """Raised when message decoding fails"""

    pass


class CloudEventValidationError(Exception):
    """Raised when CloudEvent structure is invalid"""

    pass


def safe_decode_message(data: str) -> dict:
    """Safely decode base64 and JSON message data"""
    try:
        decoded = base64.b64decode(data).decode("utf-8")
        return json.loads(decoded)
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise MessageDecodeError(f"Failed to decode message: {e}") from e
    except Exception as e:
        raise MessageDecodeError(f"Unexpected error decoding message: {e}") from e


def validate_cloud_event(event: CloudEvent) -> None:
    """Validate CloudEvent structure before processing"""
    if not event.data:
        raise CloudEventValidationError("CloudEvent data is missing")

    if not isinstance(event.data, dict):
        raise CloudEventValidationError("CloudEvent data must be a dictionary")

    if "message" not in event.data:
        raise CloudEventValidationError("CloudEvent missing 'message' field")

    if "data" not in event.data["message"]:
        raise CloudEventValidationError("CloudEvent message missing 'data' field")


@functions_framework.cloud_event
def main(event: CloudEvent) -> dict:
    """Process CloudEvent and update activity summaries"""

    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())

    # Log function invocation for debugging unacked messages
    logger.info(
        "Activity aggregator function invoked",
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
            return {
                "status": "failed",
                "error": "message_decode_failed",
                "details": str(e),
                "correlation_id": correlation_id,
            }

        # Parse and validate webhook request
        try:
            parsed_request = WebhookRequest(**event_data)
        except ValidationError as e:
            logger.error(
                "Webhook validation failed: %s",
                str(e),
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "failed",
                "error": "validation_failed",
                "details": str(e),
                "correlation_id": correlation_id,
            }

        logger.info(
            "Parsed webhook event",
            extra={"correlation_id": correlation_id, **parsed_request.model_dump()},
        )

        # Route to appropriate handler based on aspect_type
        if parsed_request.aspect_type == AspectType.CREATE:
            # Handle create events
            try:
                # Initialize summary update service
                usecase = make_update_summary_use_case()

                # Update summary data with webhook request
                logger.info(
                    "Starting summary update for activity",
                    extra={
                        "correlation_id": correlation_id,
                        "activity_id": parsed_request.object_id,
                        "owner_id": parsed_request.owner_id,
                        "aspect_type": parsed_request.aspect_type.value,
                    },
                )
                usecase.run(parsed_request)
                logger.info(
                    "Successfully updated summary for activity %s",
                    parsed_request.object_id,
                    extra={"correlation_id": correlation_id},
                )
                return {
                    "status": "processed",
                    "action": "created",
                    "activity_id": parsed_request.object_id,
                    "correlation_id": correlation_id,
                }
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
                return {
                    "status": "skipped",
                    "reason": "activity_not_found",
                    "activity_id": parsed_request.object_id,
                    "correlation_id": correlation_id,
                }
            except Exception as e:
                logger.error(
                    "Summary update failed for activity %s: %s",
                    parsed_request.object_id,
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

        elif parsed_request.aspect_type == AspectType.DELETE:
            # Handle delete events
            try:
                # Initialize delete summary service
                delete_usecase = make_delete_summary_use_case()

                # Remove activity from summary
                logger.info(
                    "Starting summary delete for activity",
                    extra={
                        "correlation_id": correlation_id,
                        "activity_id": parsed_request.object_id,
                        "owner_id": parsed_request.owner_id,
                        "aspect_type": parsed_request.aspect_type.value,
                    },
                )
                delete_usecase.run(parsed_request)
                logger.info(
                    "Successfully deleted activity %s from summary",
                    parsed_request.object_id,
                    extra={"correlation_id": correlation_id},
                )
                return {
                    "status": "processed",
                    "action": "deleted",
                    "activity_id": parsed_request.object_id,
                    "correlation_id": correlation_id,
                }
            except ActivityNotFoundError as e:
                # Activity not found - could be in BigQuery or summary
                error_message = str(e)

                # Distinguish between BigQuery miss (retry) vs summary miss (skip)
                if "BigQuery" in error_message:
                    # Activity not in BigQuery - this might be a race condition
                    # BQ inserter may still be processing, worth retrying
                    logger.error(
                        "Activity %s not found in BigQuery for deletion: %s",
                        parsed_request.object_id,
                        error_message,
                        extra={
                            "correlation_id": correlation_id,
                            "activity_id": parsed_request.object_id,
                            "error_type": "activity_not_found_in_bigquery",
                        },
                    )
                    # Re-raise to trigger retry (race condition handling)
                    raise
                else:
                    # Activity not in summary - this is normal/expected
                    # Activity may have been filtered (wrong type) or never aggregated
                    logger.warning(
                        "Activity %s not in summary for deletion (skipping): %s",
                        parsed_request.object_id,
                        error_message,
                        extra={
                            "correlation_id": correlation_id,
                            "activity_id": parsed_request.object_id,
                            "error_type": "activity_not_in_summary",
                        },
                    )
                    # Return success - nothing to delete from summary
                    return {
                        "status": "skipped",
                        "reason": "activity_not_in_summary",
                        "activity_id": parsed_request.object_id,
                        "correlation_id": correlation_id,
                    }
            except Exception as e:
                logger.error(
                    "Summary delete failed for activity %s: %s",
                    parsed_request.object_id,
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

        else:
            # Skip update events (AspectType.UPDATE - not implemented)
            logger.info(
                "Skipping event type: %s",
                parsed_request.aspect_type.value,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "skipped",
                "aspect_type": parsed_request.aspect_type.value,
                "correlation_id": correlation_id,
            }

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
