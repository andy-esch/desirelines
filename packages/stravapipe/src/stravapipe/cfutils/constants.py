"""Shared constants for Cloud Functions and Cloud Run services.

This module centralizes magic strings used across the stravapipe package
for better maintainability, type safety, and IDE autocomplete support.
"""

from enum import StrEnum


class ResponseStatus(StrEnum):
    """Status values for API responses."""

    PROCESSED = "processed"
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"
    SKIPPED = "skipped"
    FAILED = "failed"
    HEALTHY = "healthy"


class ResponseField(StrEnum):
    """Field names for API response dictionaries."""

    STATUS = "status"
    ACTION = "action"
    REASON = "reason"
    ERROR = "error"
    DETAILS = "details"
    ACTIVITY_ID = "activity_id"
    CORRELATION_ID = "correlation_id"


class SkipReason(StrEnum):
    """Reasons for skipping event processing."""

    ACTIVITY_NOT_FOUND = "activity_not_found"
    ALREADY_EXISTS = "already_exists"
    NOT_FOUND = "not_found"
    NO_RELEVANT_UPDATES = "no_relevant_updates"
    UNKNOWN_ASPECT_TYPE = "unknown_aspect_type"
    NOT_IMPLEMENTED = "not_implemented"


class ErrorType(StrEnum):
    """Error type identifiers for failed responses."""

    MESSAGE_DECODE_FAILED = "message_decode_failed"
    VALIDATION_FAILED = "validation_failed"
    WEBHOOK_PARSE_FAILED = "webhook_parse_failed"


class CloudEventField(StrEnum):
    """Field names in CloudEvent Pub/Sub message structure."""

    MESSAGE = "message"
    DATA = "data"
    MESSAGE_ID = "messageId"
    PUBLISH_TIME = "publishTime"


class WebhookField(StrEnum):
    """Field names in Strava webhook payloads."""

    ASPECT_TYPE = "aspect_type"
    OBJECT_TYPE = "object_type"
    OBJECT_ID = "object_id"


# Default values
DEFAULT_UNKNOWN = "unknown"
