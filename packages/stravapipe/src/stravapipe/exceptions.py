"""Custom exceptions for stravapipe package."""

from collections.abc import Sequence


class StravaPipeError(Exception):
    """Base exception for all stravapipe errors."""

    pass


class ConfigurationError(StravaPipeError):
    """Raised when there are configuration issues."""

    pass


class StravaApiError(StravaPipeError):
    """Raised when Strava API calls fail."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        activity_id: int | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.activity_id = activity_id


class StravaTokenError(StravaApiError):
    """Raised when token refresh fails."""

    pass


class StravaRateLimitError(StravaApiError):
    """Raised when Strava rate limit is exceeded."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class ActivityNotFoundError(StravaApiError):
    """Raised when activity is not found in Strava API (HTTP 404).

    This typically occurs when:
    - An activity has been deleted from Strava
    - An activity ID is invalid
    - An activity is not accessible to the authenticated user

    This is a recoverable error for delete webhooks - the activity
    is already gone, so we should gracefully handle this case
    rather than retrying and sending to DLQ.
    """

    def __init__(self, activity_id: int):
        super().__init__(f"Activity {activity_id} not found", activity_id=activity_id)
        self.activity_id = activity_id


class BigQueryError(StravaPipeError):
    """Raised when BigQuery operations fail."""

    def __init__(self, message: str, errors: Sequence[dict] | None = None):
        super().__init__(message)
        self.errors = list(errors) if errors else []


class DataValidationError(StravaPipeError):
    """Raised when data validation fails."""

    pass
