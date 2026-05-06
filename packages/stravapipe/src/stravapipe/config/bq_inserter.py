"""Configuration for BigQuery inserter cloud function.

Strava API credentials are no longer needed here - the dispatcher
enriches events with activity data before publishing to Pub/Sub.
"""

import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class BQInserterConfig(BaseSettings):
    """Configuration for the BigQuery inserter cloud function.

    Loads configuration from environment variables and optionally from .env file.
    Strava API credentials are no longer required - activity data is provided
    inline by the dispatcher's enriched events.
    """

    # GCP configuration
    gcp_project_id: str
    gcp_bigquery_dataset: str

    # Optional configuration
    log_level: str = "INFO"

    # Readiness probe timeout in seconds (per-attempt; the helper retries once
    # after a short backoff). Override via READINESS_TIMEOUT env var.
    readiness_timeout: float = 10.0

    # Feature flag: enables the dual-write experimental path that writes a
    # subset of activity fields to a temp table via the BigQuery Storage
    # Write API alongside the production insertAll write. Default false so
    # the experiment is opt-in per environment. See spike task
    # `spike-bigquery-storage-write-api-for-stravapipe`.
    bq_swapi_experiment_enabled: bool = False
    # The temp table name for the experiment. Hard-coded default matches
    # Terraform; exposed as a setting so tests can override it.
    bq_swapi_experiment_table: str = "activities_swapi_experiment"

    model_config = SettingsConfigDict(
        env_file=".env",
        validate_default=True,
        extra="ignore",  # Allow extra environment variables
    )

    @property
    def project_id(self) -> str:
        """Alias for gcp_project_id."""
        return self.gcp_project_id

    @property
    def bq_dataset(self) -> str:
        """Alias for gcp_bigquery_dataset."""
        return self.gcp_bigquery_dataset


def load_bq_inserter_config() -> BQInserterConfig:
    """Load and validate configuration for the BQ inserter function.

    Priority order:
    1. Environment variables
    2. .env file (if present)

    Returns:
        BQInserterConfig: Validated configuration instance.

    Raises:
        ValidationError: If required configuration is missing or invalid.
    """
    return BQInserterConfig()  # type: ignore[call-arg]  # fields from env vars
