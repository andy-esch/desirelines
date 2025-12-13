"""Configuration for PostgreSQL writer cloud function."""

import json
import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from stravapipe.config.common import StravaApiConfig
from stravapipe.domain import StravaTokenSet


class PostgresWriterConfig(BaseSettings):
    """Configuration for the PostgreSQL writer cloud function.

    Loads configuration from environment variables and optionally from
    secret volumes mounted at /etc/secrets/.
    """

    # GCP configuration
    gcp_project_id: str = Field(description="GCP project ID")

    # PostgreSQL configuration
    postgres_connection_string: str = Field(
        description="PostgreSQL connection string (postgresql+psycopg://...)"
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
    """
    # Load Strava secrets from mounted volume if available
    strava_secrets_path = "/etc/secrets/strava_auth.json"
    if os.path.exists(strava_secrets_path):
        with open(strava_secrets_path, encoding="utf-8") as f:
            strava_auth = json.load(f)
            if strava_auth.get("client_id"):
                os.environ["STRAVA_CLIENT_ID"] = str(strava_auth["client_id"])
            if strava_auth.get("client_secret"):
                os.environ["STRAVA_CLIENT_SECRET"] = strava_auth["client_secret"]
            if strava_auth.get("refresh_token"):
                os.environ["STRAVA_REFRESH_TOKEN"] = strava_auth["refresh_token"]

    # Load PostgreSQL connection string from mounted volume if available
    postgres_secrets_path = "/etc/secrets/postgres/connection_string"
    if os.path.exists(postgres_secrets_path):
        with open(postgres_secrets_path, encoding="utf-8") as f:
            os.environ["POSTGRES_CONNECTION_STRING"] = f.read().strip()

    # Load config from environment variables (and secrets set above)
    return PostgresWriterConfig.model_validate({})
