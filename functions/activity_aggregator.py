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

from aggregator.application.usecases import make_update_summary_use_case
from aggregator.domain import WebhookRequest

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
            # Re-raise to trigger PubSub retry and eventual DLQ forwarding
            raise

        # Parse and validate webhook request
        try:
            parsed_request = WebhookRequest(**event_data)
        except ValidationError as e:
            logger.error(
                "Webhook validation failed: %s",
                str(e),
                extra={"correlation_id": correlation_id},
            )
            # Re-raise to trigger PubSub retry and eventual DLQ forwarding
            raise

        logger.info(
            "Parsed webhook event",
            extra={"correlation_id": correlation_id, **parsed_request.model_dump()},
        )

        # Skip non-create events
        if parsed_request.aspect_type != "create":
            logger.info(
                "Skipping non-create event: %s",
                parsed_request.aspect_type,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "skipped",
                "reason": "non_create_event",
                "aspect_type": parsed_request.aspect_type,
                "correlation_id": correlation_id,
            }

        # Process create events
        try:
            # Initialize summary update service with error handling
            try:
                usecase = make_update_summary_use_case()
            except Exception as e:
                logger.error(
                    "Failed to initialize summary update service: %s",
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

            # Update summary data with webhook request
            logger.info(
                "Starting summary update for activity",
                extra={
                    "correlation_id": correlation_id,
                    "activity_id": parsed_request.object_id,
                    "owner_id": parsed_request.owner_id,
                    "aspect_type": parsed_request.aspect_type,
                },
            )
            usecase.run(parsed_request)
            logger.info(
                "Successfully updated summary for activity %s",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            result = {
                "status": "processed",
                "object_id": parsed_request.object_id,
                "correlation_id": correlation_id,
            }
            logger.info(
                "Activity aggregator function completed successfully",
                extra={"correlation_id": correlation_id, "result": result},
            )
            return result
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
