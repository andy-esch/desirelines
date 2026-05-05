"""Configuration for PostgreSQL writer cloud function.

Strava API credentials are no longer needed here - the dispatcher
enriches events with activity data before publishing to Pub/Sub.
"""

import logging

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Import directly from module to avoid pulling in SQLAlchemy dependencies
from stravapipe.adapters.postgres._connection import load_connection_string

logger = logging.getLogger(__name__)


class PostgresWriterConfig(BaseSettings):
    """Configuration for the PostgreSQL writer cloud function.

    Loads configuration from environment variables and optionally from .env file.
    Strava API credentials are no longer required - activity data is provided
    inline by the dispatcher's enriched events.
    """

    # GCP configuration
    gcp_project_id: str

    # Environment
    environment: str = "dev"
    log_level: str = "INFO"
    enable_cloud_logging: bool = False

    # Database configuration
    postgres_connection_string: str = Field(description="PostgreSQL connection string")

    # Readiness probe timeout (per-attempt; the helper retries once after a
    # short backoff). Override via READINESS_TIMEOUT_S env var.
    readiness_timeout_s: float = 10.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def load_postgres_writer_config() -> PostgresWriterConfig:
    """Load and validate configuration for the PostgreSQL writer function.

    Priority order:
    1. Environment variables
    2. .env file (if present)

    Returns:
        Validated PostgresWriterConfig object.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
    """
    config_dict: dict[str, str] = {}

    # Load PostgreSQL connection string with validation and dialect transformation
    # This reads from secret volume or env var, validates application_name,
    # and transforms postgresql:// to postgresql+psycopg://
    config_dict["postgres_connection_string"] = load_connection_string()

    # Load config, prioritizing passed values over env vars
    return PostgresWriterConfig.model_validate(config_dict)
