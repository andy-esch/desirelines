"""Configuration for PostgreSQL writer cloud function.

Strava API credentials are no longer needed here - the dispatcher
enriches events with activity data before publishing to Pub/Sub.
"""

import logging

from stravapipe.config._postgres_service import (
    PostgresServiceConfig,
    load_postgres_service_config,
)

logger = logging.getLogger(__name__)


class PostgresWriterConfig(PostgresServiceConfig):
    """Configuration for the PostgreSQL writer cloud function.

    Loads configuration from environment variables and optionally from .env file.
    Strava API credentials are no longer required - activity data is provided
    inline by the dispatcher's enriched events.

    Shared settings (gcp_project_id, log_level, postgres_connection_string,
    readiness_timeout) come from PostgresServiceConfig.
    """

    environment: str = "dev"
    enable_cloud_logging: bool = False


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
    return load_postgres_service_config(PostgresWriterConfig)
