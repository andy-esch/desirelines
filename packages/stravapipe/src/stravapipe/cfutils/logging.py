"""Logging setup for Cloud Functions"""

import logging

import google.cloud.logging


class JsonFieldsAdapter(logging.LoggerAdapter):
    """LoggerAdapter that wraps extra fields in json_fields for GCP structured logging

    This adapter automatically transforms extra={...} into extra={"json_fields": {...}}
    which is required by Google Cloud Logging to populate jsonPayload fields.
    """

    def process(self, msg, kwargs):
        """Wrap extra fields in json_fields for structured logging"""
        if kwargs.get("extra"):
            # Wrap existing extra dict in json_fields
            kwargs["extra"] = {"json_fields": kwargs["extra"]}
        return msg, kwargs


def setup_cloud_function_logging(logger_name: str) -> logging.LoggerAdapter:
    """Set up Cloud Functions compatible logging using Google Cloud Logging

    Uses the official google-cloud-logging library which automatically
    integrates with GCP and properly maps severity levels (INFO, WARNING, ERROR, etc.).

    Returns a LoggerAdapter that automatically wraps extra fields in json_fields
    for GCP structured logging (jsonPayload).

    For local development, falls back to standard logging if Cloud Logging is unavailable.

    Args:
        logger_name: Name for the logger (typically __name__)

    Returns:
        Configured LoggerAdapter instance that handles json_fields transformation
    """
    try:
        client = google.cloud.logging.Client()
        client.setup_logging(log_level=logging.INFO)
    except Exception as e:
        # Local dev or missing credentials - use standard logging
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )
        logging.getLogger(logger_name).warning(
            "Cloud Logging unavailable, using standard logging: %s", str(e)
        )

    base_logger = logging.getLogger(logger_name)
    return JsonFieldsAdapter(base_logger, {})
