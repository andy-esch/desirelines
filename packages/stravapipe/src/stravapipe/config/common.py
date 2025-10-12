"""Common configuration shared across functions."""

from typing import NamedTuple


class StravaApiConfig(NamedTuple):
    """Strava API configuration with defaults for retry and timeout behavior."""

    token_url: str = "https://www.strava.com/oauth/token"
    api_base_url: str = "https://www.strava.com/api/v3"
    request_timeout: int = 10
    token_retry_attempts: int = 2
    token_retry_backoff: float = 0.5
    activity_retry_attempts: int = 3
    activity_retry_backoff: float = 1.0
