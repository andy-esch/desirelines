"""Standardized response helpers for Cloud Functions"""

from stravapipe.cfutils.constants import ResponseField, ResponseStatus


def success_response(
    action: str,
    activity_id: int | None,
    correlation_id: str,
) -> dict:
    """Construct success response for processed events

    Args:
        action: Action performed (e.g., "created", "deleted")
        activity_id: Strava activity ID
        correlation_id: Request correlation ID for tracing

    Returns:
        Standardized success response dict
    """
    return {
        ResponseField.STATUS: ResponseStatus.PROCESSED,
        ResponseField.ACTION: action,
        ResponseField.ACTIVITY_ID: activity_id,
        ResponseField.CORRELATION_ID: correlation_id,
    }


def skipped_response(
    reason: str,
    correlation_id: str,
    activity_id: int | None = None,
    details: str | None = None,
) -> dict:
    """Construct skipped response for events that don't need processing

    Args:
        reason: Why the event was skipped
        correlation_id: Request correlation ID for tracing
        activity_id: Optional activity ID
        details: Optional additional details

    Returns:
        Standardized skipped response dict
    """
    return {
        ResponseField.STATUS: ResponseStatus.SKIPPED,
        ResponseField.REASON: reason,
        ResponseField.ACTIVITY_ID: activity_id,
        ResponseField.CORRELATION_ID: correlation_id,
        ResponseField.DETAILS: details,
    }


def error_response(
    error_type: str,
    details: str,
    correlation_id: str,
) -> dict:
    """Construct error response for permanent failures (no retry)

    Args:
        error_type: Type of error (e.g., "validation_failed")
        details: Error details
        correlation_id: Request correlation ID for tracing

    Returns:
        Standardized error response dict
    """
    return {
        ResponseField.STATUS: ResponseStatus.FAILED,
        ResponseField.ERROR: error_type,
        ResponseField.DETAILS: details,
        ResponseField.CORRELATION_ID: correlation_id,
    }
