"""Shared constants for Cloud Run services.

This module centralizes magic strings used across the stravapipe package
for better maintainability, type safety, and IDE autocomplete support.
"""

from enum import StrEnum
from typing import Final

# The platform stravapipe ingests activities from. The schema has no default for
# it: writers record it on every activity, mapping and tombstone, and logs and
# spans name it next to the activity's ID there (`external_id`).
ACTIVITY_SOURCE: Final[str] = "strava"


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


# Default values
DEFAULT_UNKNOWN = "unknown"
