"""Common configuration shared across functions."""

import logging
from typing import NamedTuple

logger = logging.getLogger(__name__)


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


def load_secrets_from_volumes(
    secret_names: list[str], base_path: str = "/etc/secrets"
) -> dict[str, str]:
    """Load secrets from atomic volume mounts.

    Iterates through the provided secret names. For each secret, attempts to
    read the value from `{base_path}/{secret_name}/value`.

    Args:
        secret_names: List of secret names (e.g. ["STRAVA_CLIENT_ID"]).
                      The filename is expected to be `{name}/value`.
        base_path: Base directory for secrets. Defaults to "/etc/secrets".

    Returns:
        Dictionary mapping secret names to their values.

    Raises:
        OSError: If a file exists but cannot be read (e.g. permission denied).
                 FileNotFoundError is ignored (graceful fallback).
    """
    secrets: dict[str, str] = {}
    for name in secret_names:
        secret_path = f"{base_path}/{name}/value"
        try:
            with open(secret_path, encoding="utf-8") as f:
                secrets[name] = f.read()
                logger.info("config: loaded %s from file: %s", name, secret_path)
        except FileNotFoundError:
            # Secret not mounted, skip (will rely on env var or default)
            pass
    return secrets
