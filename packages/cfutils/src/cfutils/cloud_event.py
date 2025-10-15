"""CloudEvent processing utilities for Cloud Functions"""

import base64
import binascii
import json
import logging

from cloudevents.http import CloudEvent


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
    """Set up Cloud Functions compatible logging

    Args:
        logger_name: Name for the logger (typically __name__)

    Returns:
        Configured logger instance
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    logger = logging.getLogger(logger_name)

    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(logging.INFO)
        formatter = logging.Formatter("%(levelname)s:%(name)s:%(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)

    return logger
