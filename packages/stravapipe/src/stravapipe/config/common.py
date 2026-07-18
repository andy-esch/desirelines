"""Common configuration shared across functions."""

import logging
import os
from pathlib import Path
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
        secret_path = Path(base_path) / name / "value"
        try:
            with secret_path.open(encoding="utf-8") as f:
                secrets[name] = f.read()
                logger.info("config: loaded %s from file: %s", name, secret_path)
        except FileNotFoundError:
            # Secret not mounted, skip (will rely on env var or default)
            pass
    return secrets


def load_strava_secrets() -> dict[str, str]:
    """Load Strava API secrets from volumes or environment.

    Standardizes the loading of:
    - INFISICAL_STRAVA_CLIENT_ID -> strava_client_id
    - INFISICAL_STRAVA_CLIENT_SECRET -> strava_client_secret

    Returns:
        Dictionary with mapped keys (field names for config model).
    """
    # Map infrastructure secret names (from Infisical/Terraform) to application config keys
    secret_mapping = {
        "INFISICAL_STRAVA_CLIENT_ID": "strava_client_id",
        "INFISICAL_STRAVA_CLIENT_SECRET": "strava_client_secret",
    }

    secret_names = list(secret_mapping.keys())

    # Load Strava secrets from atomic mounted volumes if available
    raw_secrets = load_secrets_from_volumes(secret_names)

    # Log fallbacks for secrets not found in volumes
    for name in secret_names:
        if name not in raw_secrets:
            # Check env var without INFISICAL_ prefix for backwards compatibility
            # This logic mimics the previous string replacement but only for LOGGING purposes
            env_name = name.replace("INFISICAL_", "")
            if os.getenv(env_name):
                logger.info("config: loaded %s from environment", env_name)

    # Remap infra secret names → config keys. Every key in raw_secrets is drawn
    # from secret_names (== secret_mapping keys), so no membership guard is needed.
    return {secret_mapping[k]: v for k, v in raw_secrets.items()}
