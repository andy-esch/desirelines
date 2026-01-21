"""Common configuration shared across functions."""

from typing import NamedTuple


class StravaApiConfig(NamedTuple):
    """Strava API configuration with defaults for retry and timeout behavior.

    Timeout and retry values are tuned for Strava API characteristics:
    - Strava typically responds within 1-2s, 10s timeout catches slowdowns
    - Token refresh is critical path, so fewer retries (2) with fast backoff (0.5s)
    - Activity fetches are more tolerant, so more retries (3) with longer backoff (1s)
    - Backoff values balance responsiveness vs. not hammering a struggling API
    """

    token_url: str = "https://www.strava.com/oauth/token"
    api_base_url: str = "https://www.strava.com/api/v3"

    # 10s timeout: Strava typically responds in 1-2s, this catches network issues
    request_timeout: int = 10

    # Token refresh: fewer retries, fast backoff (critical path, fail fast)
    token_retry_attempts: int = 2
    token_retry_backoff: float = 0.5

    # Activity fetch: more retries, longer backoff (can tolerate delays)
    activity_retry_attempts: int = 3
    activity_retry_backoff: float = 1.0
