"""Custom exceptions for stravabqsync application."""

from collections.abc import Sequence


class StravaBqSyncError(Exception):
    """Base exception for all stravabqsync errors."""

    pass


class ConfigurationError(StravaBqSyncError):
    """Raised when there are configuration issues."""

    pass


class StravaApiError(StravaBqSyncError):
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
    """Raised when requested activity doesn't exist."""

    def __init__(self, activity_id: int):
        super().__init__(f"Activity {activity_id} not found")
        self.activity_id = activity_id


class BigQueryError(StravaBqSyncError):
    """Raised when BigQuery operations fail."""

    def __init__(self, message: str, errors: Sequence[dict] | None = None):
        super().__init__(message)
        self.errors = list(errors) if errors else []


class DataValidationError(StravaBqSyncError):
    """Raised when data validation fails."""

    pass
