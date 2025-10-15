"""CloudEvent processing utilities for Cloud Functions"""

import base64
import binascii
import json
import logging

from cloudevents.http import CloudEvent
import google.cloud.logging


class MessageDecodeError(Exception):
    """Raised when message decoding fails"""

    pass


class CloudEventValidationError(Exception):
    """Raised when CloudEvent structure is invalid"""

    pass


def safe_decode_message(data: str) -> dict:
    """Safely decode base64 and JSON message data

    Args:
        data: Base64-encoded JSON string

    Returns:
        Decoded dict

    Raises:
        MessageDecodeError: If decoding fails
    """
    try:
        decoded = base64.b64decode(data).decode("utf-8")
        return json.loads(decoded)
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise MessageDecodeError(f"Failed to decode message: {e}") from e
    except Exception as e:
        raise MessageDecodeError(f"Unexpected error decoding message: {e}") from e


def validate_cloud_event(event: CloudEvent) -> None:
    """Validate CloudEvent structure before processing

    Args:
        event: CloudEvent to validate

    Raises:
        CloudEventValidationError: If event structure is invalid
    """
    if not event.data:
        raise CloudEventValidationError("CloudEvent data is missing")

    if not isinstance(event.data, dict):
        raise CloudEventValidationError("CloudEvent data must be a dictionary")

    if "message" not in event.data:
        raise CloudEventValidationError("CloudEvent missing 'message' field")

    if "data" not in event.data["message"]:
        raise CloudEventValidationError("CloudEvent message missing 'data' field")


def setup_cloud_function_logging(logger_name: str) -> logging.Logger:
    """Set up Cloud Functions compatible logging using Google Cloud Logging

    Uses the official google-cloud-logging library which automatically
    integrates with GCP and properly maps severity levels (INFO, WARNING, ERROR, etc.).

    Args:
        logger_name: Name for the logger (typically __name__)

    Returns:
        Configured logger instance
    """
    client = google.cloud.logging.Client()
    client.setup_logging(log_level=logging.INFO)

    return logging.getLogger(logger_name)
