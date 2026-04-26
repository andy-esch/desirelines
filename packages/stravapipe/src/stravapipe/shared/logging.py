"""Logging setup for Cloud Run services."""

from collections.abc import MutableMapping
import logging
import os
from typing import Any

import google.cloud.logging


class JsonFieldsAdapter(logging.LoggerAdapter[logging.Logger]):
    """LoggerAdapter that wraps extra fields in json_fields for GCP structured logging

    This adapter automatically transforms extra={...} into extra={"json_fields": {...}}
    which is required by Google Cloud Logging to populate jsonPayload fields.
    """

    def process(
        self, msg: Any, kwargs: MutableMapping[str, Any]
    ) -> tuple[Any, MutableMapping[str, Any]]:
        """Wrap extra fields in json_fields for structured logging"""
        if kwargs.get("extra"):
            # Wrap existing extra dict in json_fields
            kwargs["extra"] = {"json_fields": kwargs["extra"]}
        return msg, kwargs


def setup_logging(logger_name: str) -> logging.LoggerAdapter[logging.Logger]:
    """Set up GCP-compatible structured logging using Google Cloud Logging

    Uses the official google-cloud-logging library which automatically
    integrates with GCP and properly maps severity levels (INFO, WARNING, ERROR, etc.).

    Returns a LoggerAdapter that automatically wraps extra fields in json_fields
    for GCP structured logging (jsonPayload).

    Set ENABLE_CLOUD_LOGGING=true to enable GCP Cloud Logging integration.
    When not set or false, uses standard logging.

    Args:
        logger_name: Name for the logger (typically __name__)

    Returns:
        Configured LoggerAdapter instance that handles json_fields transformation
    """
    enable_cloud_logging = os.environ.get("ENABLE_CLOUD_LOGGING", "").lower() == "true"

    if enable_cloud_logging:
        try:
            # google-cloud-logging ships untyped; ignore the two calls below.
            client = google.cloud.logging.Client()  # type: ignore[no-untyped-call]
            client.setup_logging(log_level=logging.INFO)  # type: ignore[no-untyped-call]
        except Exception as e:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            )
            logging.getLogger(logger_name).warning(
                "Cloud Logging unavailable, using standard logging: %s", str(e)
            )
    else:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            force=True,
        )

    base_logger = logging.getLogger(logger_name)
    return JsonFieldsAdapter(base_logger, {})
