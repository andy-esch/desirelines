"""Configuration for PostgreSQL writer cloud function."""

import logging

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Import directly from module to avoid pulling in SQLAlchemy dependencies
from stravapipe.adapters.postgres._connection import load_connection_string
from stravapipe.config.common import StravaApiConfig, load_strava_secrets
from stravapipe.domain import StravaTokenSet

logger = logging.getLogger(__name__)


class PostgresWriterConfig(BaseSettings):
    """Configuration for the PostgreSQL writer cloud function.

    Loads configuration from environment variables and optionally from
    secret volumes mounted at /etc/secrets/.
    """

    # GCP configuration
    gcp_project_id: str

    # Environment
    environment: str = "dev"
    log_level: str = "INFO"
    enable_cloud_logging: bool = False

    # Strava API configuration (secrets)
    strava_client_id: int = Field(description="Strava API client ID")
    strava_client_secret: str = Field(description="Strava API client secret")
    strava_refresh_token: str = Field(description="Strava API refresh token")

    # Database configuration
    postgres_connection_string: str = Field(description="PostgreSQL connection string")

    # API defaults (timeouts, retries)
    strava_api: StravaApiConfig = StravaApiConfig()

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def strava_tokens(self) -> StravaTokenSet:
        """Get Strava tokens for API authentication."""
        return StravaTokenSet(
            client_id=self.strava_client_id,
            client_secret=self.strava_client_secret,
            refresh_token=self.strava_refresh_token,
        )


def load_postgres_writer_config() -> PostgresWriterConfig:
    """Load and validate configuration for the PostgreSQL writer function.

    Priority order:
    1. Secret volumes at /etc/secrets/INFISICAL_* (if present)
    2. Environment variables (STRAVA_* for backwards compatibility)
    3. .env file (if present)

    Returns:
        Validated PostgresWriterConfig object.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
    """
    # Load Strava secrets and map keys
    config_dict = load_strava_secrets()

    # Load PostgreSQL connection string with validation and dialect transformation
    # This reads from secret volume or env var, validates application_name,
    # and transforms postgresql:// to postgresql+psycopg://
    config_dict["postgres_connection_string"] = load_connection_string()

    # Load config, prioritizing passed values over env vars
    return PostgresWriterConfig.model_validate(config_dict)
