"""Configuration for the deletion service Cloud Run service.

Handles user data deletion across PostgreSQL, BigQuery, and Firestore
when a user deauthorizes the app from Strava.
"""

import logging

from stravapipe.config._postgres_service import (
    PostgresServiceConfig,
    load_postgres_service_config,
)

logger = logging.getLogger(__name__)


class DeletionServiceConfig(PostgresServiceConfig):
    """Configuration for the deletion service.

    Loads configuration from environment variables and optionally from .env file.

    Shared settings (gcp_project_id, log_level, postgres_connection_string,
    readiness_timeout) come from PostgresServiceConfig.
    """

    gcp_bigquery_dataset: str
    firestore_database: str

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
    return load_postgres_service_config(DeletionServiceConfig)
