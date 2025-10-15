"""Logging setup for Cloud Functions"""

import logging

import google.cloud.logging_v2.handlers


def setup_cloud_function_logging(logger_name: str) -> logging.Logger:
    """Set up Cloud Functions compatible logging using Google Cloud Logging

    Uses StructuredLogHandler to properly send extra fields (correlation_id, etc.)
    to jsonPayload while maintaining proper severity levels.

    Args:
        logger_name: Name for the logger (typically __name__)

    Returns:
        Configured logger instance
    """
    handler = google.cloud.logging_v2.handlers.StructuredLogHandler()

    # Configure the root logger
    logging.basicConfig(level=logging.INFO, handlers=[handler])

    return logging.getLogger(logger_name)
