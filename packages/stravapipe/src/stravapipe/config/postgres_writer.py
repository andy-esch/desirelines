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
    1. Secret volumes at /etc/secrets/ (if present)
    2. Environment variables
    3. .env file (if present)

    Returns:
        PostgresWriterConfig: Validated configuration instance.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
    """
    secret_names = [
        "STRAVA_CLIENT_ID",
        "STRAVA_CLIENT_SECRET",
        "STRAVA_REFRESH_TOKEN",
    ]
    # Load Strava secrets from atomic mounted volumes if available
    raw_secrets = load_secrets_from_volumes(secret_names)

    # Log fallbacks for secrets not found in volumes
    for name in secret_names:
        if name not in raw_secrets:
            if os.getenv(name):
                logger.info("config: loaded %s from environment", name)

    # Map UPPER_CASE secret names to snake_case model fields
    config_dict = {k.lower(): v for k, v in raw_secrets.items()}

    # Load PostgreSQL connection string with validation and dialect transformation
    # This reads from secret volume or env var, validates application_name,
    # and transforms postgresql:// to postgresql+psycopg://
    config_dict["postgres_connection_string"] = load_connection_string()

    # Load config, prioritizing passed values over env vars
    return PostgresWriterConfig.model_validate(config_dict)
