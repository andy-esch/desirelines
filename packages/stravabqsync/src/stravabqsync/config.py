"""Configuration for stravabqsync package"""

import json
import os
from typing import NamedTuple

from pydantic_settings import BaseSettings, SettingsConfigDict

from stravabqsync.domain import StravaTokenSet


class StravaApiConfig(NamedTuple):
    """Strava API configuration"""

    token_url: str = "https://www.strava.com/oauth/token"
    api_base_url: str = "https://www.strava.com/api/v3"
    request_timeout: int = 10
    token_retry_attempts: int = 2
    token_retry_backoff: float = 0.5
    activity_retry_attempts: int = 3
    activity_retry_backoff: float = 1.0


# Function-specific configuration for BQ Inserter cloud function


class BQInserterConfig(BaseSettings):
    """Configuration for the BigQuery inserter cloud function"""

    # GCP configuration
    gcp_project_id: str
    gcp_bigquery_dataset: str

    # Strava API configuration
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

    @property
    def tokens(self) -> StravaTokenSet:
        """Create StravaTokenSet from config values"""
        return StravaTokenSet(
            client_id=self.strava_client_id,
            client_secret=self.strava_client_secret,
            access_token="",  # Will be refreshed on first use
            refresh_token=self.strava_refresh_token,
        )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id"""
        return self.gcp_project_id

    @property
    def bq_dataset(self) -> str:
        """Alias for gcp_bigquery_dataset"""
        return self.gcp_bigquery_dataset

    @property
    def strava_api(self) -> StravaApiConfig:
        """Create StravaApiConfig with defaults"""
        return StravaApiConfig()


def load_bq_inserter_config() -> BQInserterConfig:
    """Load and validate configuration for the BQ inserter function"""

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
    return BQInserterConfig.model_validate({})
