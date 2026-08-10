"""Shared constants for Cloud Run services.

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
    HEALTHY = "healthy"


class SkipReason(StrEnum):
    """Reasons for skipping event processing."""

    ACTIVITY_NOT_FOUND = "activity_not_found"
    ALREADY_EXISTS = "already_exists"
    NOT_FOUND = "not_found"
    NO_RELEVANT_UPDATES = "no_relevant_updates"
    NOT_IMPLEMENTED = "not_implemented"
    STALE_EVENT = "stale_event"
    RESURRECTION_BLOCKED = "resurrection_blocked"


class WebhookField(StrEnum):
    """Field names in Strava webhook payloads."""

    ASPECT_TYPE = "aspect_type"
    OBJECT_TYPE = "object_type"
    OBJECT_ID = "object_id"


# Default values
DEFAULT_UNKNOWN = "unknown"
