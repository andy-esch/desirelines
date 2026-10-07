"""Custom exceptions for stravapipe package."""

from collections.abc import Sequence
from typing import Any


class StravaPipeError(Exception):
    """Base exception for all stravapipe errors."""


class ConfigurationError(StravaPipeError):
    """Raised when there are application configuration issues."""


class StravaApiError(StravaPipeError):
    """Raised when Strava API calls fail.

    ``external_id`` is the activity's Strava ID, when the call concerned one.
    """

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        external_id: int | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.external_id = external_id


class StravaTokenError(StravaApiError):
    """Raised when strava token refresh fails."""


class StravaRateLimitError(StravaApiError):
    """Raised when Strava rate limit is exceeded."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


class ActivityNotFoundError(StravaApiError):
    """Raised when Strava has no such activity (HTTP 404).

    Typically the activity was deleted from Strava, the ID is invalid, or the
    authenticated athlete can't see it. Recoverable: the activity is already
    gone.
    """

    def __init__(self, external_id: int, message: str | None = None):
        """Initialize ActivityNotFoundError.

        Args:
            external_id: The activity's Strava ID
            message: Optional custom error message. If not provided, uses default.
        """
        error_message = message or f"Activity {external_id} not found"
        # StravaApiError.__init__ already stores external_id.
        super().__init__(error_message, external_id=external_id)


class BigQueryError(StravaPipeError):
    """Raised when BigQuery operations fail."""

    def __init__(self, message: str, errors: Sequence[dict[str, Any]] | None = None):
        super().__init__(message)
        self.errors = list(errors) if errors else []


class StreamingBufferDMLError(BigQueryError):
    """Raised when a DML operation targets rows still in the streaming buffer.

    BigQuery streaming inserts hold rows in a per-table buffer for up to
    ~90 minutes before they're flushed to long-term storage. While buffered,
    rows cannot be modified by UPDATE, DELETE, or MERGE statements that
    target them. The API rejects such DML with HTTP 400.

    This is an expected, transient condition — not a bug. Callers that
    perform best-effort cleanup (e.g. activities_staging post-MERGE) should
    catch this specifically and treat it as "skip and try again later."
    Bubbling up as ERROR-level pollutes alerts and obscures real failures.
    """


class DataValidationError(StravaPipeError):
    """Raised when data validation fails."""
