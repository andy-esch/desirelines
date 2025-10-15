"""Standardized response helpers for Cloud Functions"""


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
        "status": "processed",
        "action": action,
        "activity_id": activity_id,
        "correlation_id": correlation_id,
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
        "status": "skipped",
        "reason": reason,
        "activity_id": activity_id,
        "correlation_id": correlation_id,
        "details": details,
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
        "status": "failed",
        "error": error_type,
        "details": details,
        "correlation_id": correlation_id,
    }
