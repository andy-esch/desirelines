"""Logging setup for Cloud Run services."""

from collections.abc import MutableMapping
import logging
import os
from typing import Any

import google.cloud.logging

from stravapipe.shared.correlation import CorrelationFilter


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


def _parse_log_level() -> int:
    """Parse the LOG_LEVEL env var into a logging level constant.

    Accepts standard Python level names (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    case-insensitively. Empty / unset / unrecognized values fall back to INFO.

    Mirrors the Go side's LOG_LEVEL handling (packages/dispatcher/config.ParseLogLevel
    and packages/apigateway/config) so operators can adjust verbosity at runtime
    via Cloud Run env-var update without redeploying the container image.
    """
    name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = logging.getLevelNamesMapping().get(name)
    if level is None:
        # Use logging directly here — the call happens before our handler is
        # installed, so we cannot rely on the filtered logger yet.
        logging.warning("Invalid LOG_LEVEL %r, defaulting to INFO", name)
        return logging.INFO
    return level


def _install_correlation_filter() -> None:
    """Prepend CorrelationFilter to every handler attached to the root logger.

    Two subtleties drive the design:

    1. Filters on a Logger only fire for records logged *directly* through
       that logger — records propagated from child loggers bypass them. So
       attaching to the root logger does nothing for ``logging.getLogger(__name__)``.
       Handler-attached filters, by contrast, run for every record the
       handler emits regardless of which logger produced it.
    2. ``StructuredLogHandler`` installs ``CloudLoggingFilter`` in its
       ``__init__`` to populate ``record._trace`` etc. from ``record.trace``.
       That filter runs in insertion order, so CorrelationFilter must be
       inserted at position 0 to set ``record.trace`` *before* CloudLoggingFilter
       reads it. Appending would silently lose trace context in production.

    Idempotent: re-running is a no-op when a CorrelationFilter is already present.
    """
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if not any(isinstance(f, CorrelationFilter) for f in handler.filters):
            handler.filters.insert(0, CorrelationFilter())


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
    log_level = _parse_log_level()

    if enable_cloud_logging:
        try:
            # google-cloud-logging ships untyped; ignore the two calls below.
            client = google.cloud.logging.Client()  # type: ignore[no-untyped-call]
            client.setup_logging(log_level=log_level)  # type: ignore[no-untyped-call]
        except Exception as e:
            logging.basicConfig(
                level=log_level,
                format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            )
            logging.getLogger(logger_name).warning(
                "Cloud Logging unavailable, using standard logging: %s", str(e)
            )
    else:
        logging.basicConfig(
            level=log_level,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            force=True,
        )

    # Auto-inject correlation_id and trace context into every log record.
    # Must run after Cloud Logging or basicConfig has installed handlers.
    _install_correlation_filter()

    base_logger = logging.getLogger(logger_name)
    return JsonFieldsAdapter(base_logger, {})
