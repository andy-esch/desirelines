"""Strava BigQuery sync - syncs Strava activities to BigQuery"""

import base64
import binascii
import json
import logging
import uuid

from cloudevents.http import CloudEvent
import functions_framework
from pydantic import ValidationError

from stravabqsync.application.services import make_sync_service
from stravabqsync.config import load_bq_inserter_config
from stravabqsync.domain import WebhookRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load and validate configuration at module level
try:
    bq_config = load_bq_inserter_config()
    logger.info("BQ Inserter configuration loaded successfully")
except ValidationError as e:
    logger.error("BQ Inserter configuration validation failed: %s", e)
    bq_config = None
except Exception as e:
    logger.error("Failed to load BQ Inserter configuration: %s", e)
    bq_config = None


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
    """Process CloudEvent and sync Strava activity to BigQuery"""

    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())

    try:
        # Validate CloudEvent structure
        validate_cloud_event(event)
        logger.info(
            "Received CloudEvent for processing",
            extra={"correlation_id": correlation_id},
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
            # Initialize sync service with error handling
            try:
                usecase = make_sync_service()
            except Exception as e:
                logger.error(
                    "Failed to initialize sync service: %s",
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                return {
                    "status": "failed",
                    "error": "service_initialization_failed",
                    "details": str(e),
                    "correlation_id": correlation_id,
                }

            # Runner: Insert activity with parsed_request.object_id into BigQuery
            usecase.run(parsed_request.object_id)
            logger.info(
                "Successfully synced activity %s to BigQuery",
                parsed_request.object_id,
                extra={"correlation_id": correlation_id},
            )
            return {
                "status": "processed",
                "object_id": parsed_request.object_id,
                "correlation_id": correlation_id,
            }
        except Exception as e:
            logger.error(
                "BigQuery sync failed for activity %s: %s",
                parsed_request.object_id,
                str(e),
                extra={"correlation_id": correlation_id},
                exc_info=True,
            )
            return {
                "status": "failed",
                "error": "sync_failed",
                "object_id": parsed_request.object_id,
                "details": str(e),
                "correlation_id": correlation_id,
            }

    except CloudEventValidationError as e:
        logger.error(
            "Invalid CloudEvent structure: %s",
            e,
            extra={"correlation_id": correlation_id},
        )
        return {
            "status": "failed",
            "error": "invalid_cloud_event",
            "details": str(e),
            "correlation_id": correlation_id,
        }

    except Exception as e:
        logger.error(
            "Unexpected error processing CloudEvent: %s",
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        return {
            "status": "failed",
            "error": "unexpected_error",
            "details": str(e),
            "correlation_id": correlation_id,
        }
