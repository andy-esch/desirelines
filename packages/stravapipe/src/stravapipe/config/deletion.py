"""Configuration for the deletion service Cloud Run service.

Handles user data deletion across PostgreSQL, BigQuery, and Firestore
when a user deauthorizes the app from Strava.
"""

import logging

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from stravapipe.adapters.postgres._connection import load_connection_string

logger = logging.getLogger(__name__)


class DeletionServiceConfig(BaseSettings):
    """Configuration for the deletion service.

    Loads configuration from environment variables and optionally from .env file.
    """

    # GCP configuration
    gcp_project_id: str
    gcp_bigquery_dataset: str
    firestore_database: str

    # Environment
    log_level: str = "INFO"

    # Database configuration
    postgres_connection_string: str = Field(description="PostgreSQL connection string")

    # Readiness probe timeout in seconds (per-attempt; the helper retries once
    # after a short backoff). Override via READINESS_TIMEOUT env var.
    readiness_timeout: float = 10.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id."""
        return self.gcp_project_id

    @property
    def bq_dataset(self) -> str:
        """Alias for gcp_bigquery_dataset."""
        return self.gcp_bigquery_dataset


def load_deletion_service_config() -> DeletionServiceConfig:
    """Load and validate configuration for the deletion service.

    Returns:
        Validated DeletionServiceConfig object.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
    """
    config_dict: dict[str, str] = {}
    config_dict["postgres_connection_string"] = load_connection_string()
    return DeletionServiceConfig.model_validate(config_dict)
