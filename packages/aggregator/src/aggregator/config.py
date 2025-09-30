"""Function-specific configurations for cloud functions"""

import json
import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class AggregatorConfig(BaseSettings):
    """Configuration for the activity aggregator cloud function"""

    # GCP configuration
    gcp_project_id: str
    gcp_bucket_name: str

    # Strava API configuration (for fetching activity data)
    strava_client_id: int
    strava_client_secret: str
    strava_refresh_token: str

    # Optional configuration
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        validate_default=True,
        extra="ignore",  # Allow extra environment variables
    )


def load_aggregator_config() -> AggregatorConfig:
    """Load and validate configuration for the aggregator function"""

    # Load Strava secrets from mounted volume if available
    strava_secrets = {}
    secrets_path = "/etc/secrets/strava_auth.json"
    if os.path.exists(secrets_path):
        with open(secrets_path, encoding="utf-8") as f:
            strava_auth = json.load(f)
            strava_secrets = {
                "STRAVA_CLIENT_ID": strava_auth.get("client_id"),
                "STRAVA_CLIENT_SECRET": strava_auth.get("client_secret"),
                "STRAVA_REFRESH_TOKEN": strava_auth.get("refresh_token"),
            }

    # Set environment variables from secrets (takes precedence)
    for key, value in strava_secrets.items():
        if value is not None:
            os.environ[key] = str(value)

    # Load config from environment variables (and secrets set above)
    return AggregatorConfig.model_validate({})
