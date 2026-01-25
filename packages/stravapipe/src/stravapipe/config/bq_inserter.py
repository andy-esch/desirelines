"""Configuration for BigQuery inserter cloud function."""

import logging
import os

from pydantic_settings import BaseSettings, SettingsConfigDict

from stravapipe.config.common import StravaApiConfig, load_secrets_from_volumes
from stravapipe.domain import StravaTokenSet

logger = logging.getLogger(__name__)


class BQInserterConfig(BaseSettings):
    """Configuration for the BigQuery inserter cloud function.

    Loads configuration from environment variables and optionally from
    secret volumes mounted at /etc/secrets/.
    """

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
        """Create StravaTokenSet from config values."""
        return StravaTokenSet(
            client_id=self.strava_client_id,
            client_secret=self.strava_client_secret,
            access_token="",  # Will be refreshed on first use
            refresh_token=self.strava_refresh_token,
        )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id."""
        return self.gcp_project_id

    @property
    def bq_dataset(self) -> str:
        """Alias for gcp_bigquery_dataset."""
        return self.gcp_bigquery_dataset

    @property
    def strava_api(self) -> StravaApiConfig:
        """Create StravaApiConfig with defaults."""
        return StravaApiConfig()


def load_bq_inserter_config() -> BQInserterConfig:
    """Load and validate configuration for the BQ inserter function.

    Priority order:
    1. Secret volumes at /etc/secrets/INFISICAL_STRAVA_* (if present)
    2. Environment variables (STRAVA_* for backwards compatibility)
    3. .env file (if present)

    Returns:
        BQInserterConfig: Validated configuration instance.

    Raises:
        ValidationError: If required configuration is missing or invalid.
    """
    secret_names = [
        "INFISICAL_STRAVA_CLIENT_ID",
        "INFISICAL_STRAVA_CLIENT_SECRET",
        "INFISICAL_STRAVA_REFRESH_TOKEN",
    ]
    # Load Strava secrets from atomic mounted volumes if available
    raw_secrets = load_secrets_from_volumes(secret_names)

    # Log fallbacks for secrets not found in volumes
    for name in secret_names:
        if name not in raw_secrets:
            # Check env var without INFISICAL_ prefix for backwards compatibility
            env_name = name.replace("INFISICAL_", "")
            if os.getenv(env_name):
                logger.info("config: loaded %s from environment", env_name)

    # Map INFISICAL_STRAVA_* secret names to strava_* model fields
    # Strip INFISICAL_ prefix and convert to lowercase
    config_dict = {
        k.replace("INFISICAL_", "").lower(): v for k, v in raw_secrets.items()
    }

    # Load config, prioritizing passed values (secrets) over env vars
    return BQInserterConfig.model_validate(config_dict)
