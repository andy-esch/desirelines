"""Custom exceptions for the aggregator package."""


class ActivityNotFoundError(Exception):
    """Raised when activity is not found in Strava API (HTTP 404).

    This typically occurs when:
    - An activity has been deleted from Strava
    - An activity ID is invalid
    - An activity is not accessible to the authenticated user

    This is a recoverable error for delete webhooks - the activity
    is already gone, so we should gracefully handle this case
    rather than retrying and sending to DLQ.
    """

    pass
