"""Configuration for PostgreSQL writer cloud function."""

import logging
import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Import directly from module to avoid pulling in SQLAlchemy dependencies
from stravapipe.adapters.postgres._connection import load_connection_string
from stravapipe.config.common import StravaApiConfig, load_secrets_from_volumes
from stravapipe.domain import StravaTokenSet

logger = logging.getLogger(__name__)


class PostgresWriterConfig(BaseSettings):
    """Configuration for the PostgreSQL writer cloud function.

    Loads configuration from environment variables and optionally from
    secret volumes mounted at /etc/secrets/.
    """

    # GCP configuration
    gcp_project_id: str = Field(description="GCP project ID")

    # PostgreSQL configuration
    # Loaded via load_connection_string() which handles:
    # - Reading from secret volume or env var
    # - Validating application_name is present
    # - Transforming to postgresql+psycopg:// dialect
    postgres_connection_string: str = Field(
        description="PostgreSQL connection string (postgresql+psycopg://user:pass@host:port/db)"
    )

    # Strava API configuration
    strava_client_id: int = Field(description="Strava API client ID")
    strava_client_secret: str = Field(description="Strava API client secret")
    strava_refresh_token: str = Field(description="Strava OAuth refresh token")

    # Optional configuration
    log_level: str = Field(default="INFO", description="Logging level")

    model_config = SettingsConfigDict(
        env_file=".env",
        validate_default=True,
        extra="ignore",
    )

    @property
    def tokens(self) -> StravaTokenSet:
        """Create StravaTokenSet from config values."""
        return StravaTokenSet(
            client_id=self.strava_client_id,
            client_secret=self.strava_client_secret,
            access_token="",  # Will be refreshed before use
            refresh_token=self.strava_refresh_token,
        )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id."""
        return self.gcp_project_id

    @property
    def strava_api(self) -> StravaApiConfig:
        """Create StravaApiConfig with defaults."""
        return StravaApiConfig()


def load_postgres_writer_config() -> PostgresWriterConfig:
    """Load and validate configuration for the PostgreSQL writer function.

    Priority order:
    1. Secret volumes at /etc/secrets/INFISICAL_* (if present)
    2. Environment variables (STRAVA_* for backwards compatibility)
    3. .env file (if present)

    Returns:
        PostgresWriterConfig: Validated configuration instance.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
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

    # Load PostgreSQL connection string with validation and dialect transformation
    # This reads from secret volume or env var, validates application_name,
    # and transforms postgresql:// to postgresql+psycopg://
    config_dict["postgres_connection_string"] = load_connection_string()

    # Load config, prioritizing passed values over env vars
    return PostgresWriterConfig.model_validate(config_dict)
