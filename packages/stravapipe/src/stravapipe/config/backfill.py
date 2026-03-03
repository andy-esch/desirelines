"""Configuration for backfill Cloud Run Job.

Loads athlete ID, year range, and database/BQ configuration from
environment variables. Designed for Cloud Run Jobs where config
is passed via env vars on job execution.

Strava client credentials come from secret volume mounts (Infisical).
Per-user access/refresh tokens come from Firestore at runtime.
"""

from datetime import UTC, datetime
import logging
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from stravapipe.adapters.postgres._connection import load_connection_string
from stravapipe.config.common import load_strava_secrets

logger = logging.getLogger(__name__)


class BackfillConfig(BaseSettings):
    """Configuration for the backfill Cloud Run Job.

    Required env vars:
        ATHLETE_ID: Strava athlete ID to backfill
        GCP_PROJECT_ID: GCP project
        POSTGRES_CONNECTION_STRING: PostgreSQL connection string

    Required secrets (volume mounts or env vars):
        INFISICAL_STRAVA_CLIENT_ID: Strava OAuth client ID
        INFISICAL_STRAVA_CLIENT_SECRET: Strava OAuth client secret

    Optional env vars:
        BACKFILL_YEARS: Comma-separated years (default: current year)
        GCP_BIGQUERY_DATASET: If set, also writes to BigQuery
        FIRESTORE_DATABASE: Firestore database ID (default: "(default)")
        BATCH_SIZE: Activities per PostgreSQL batch (default: 100)
    """

    # Required
    athlete_id: str = Field(description="Strava athlete ID to backfill")
    gcp_project_id: str

    # Strava client credentials (from secret volumes)
    strava_client_id: str = Field(description="Strava OAuth client ID")
    strava_client_secret: str = Field(description="Strava OAuth client secret")

    # Database
    postgres_connection_string: str = Field(description="PostgreSQL connection string")

    # Firestore
    firestore_database: str = Field(
        default="(default)",
        description="Firestore database ID",
    )

    # BigQuery (optional — omit to skip BQ writes)
    gcp_bigquery_dataset: str | None = None

    # Backfill parameters
    backfill_years: str | None = Field(
        default=None,
        description="Comma-separated years to backfill (e.g. '2023,2024,2025'). "
        "Defaults to current year.",
    )
    batch_size: int = 100

    # Environment
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def years(self) -> list[int]:
        """Parse backfill_years into a list of ints."""
        if self.backfill_years:
            return [int(y.strip()) for y in self.backfill_years.split(",")]
        return [datetime.now(tz=UTC).year]


def load_backfill_config() -> BackfillConfig:
    """Load and validate configuration for the backfill job.

    Priority order:
    1. Secret volume mounts (Strava client creds)
    2. Environment variables
    3. .env file (if present)

    Returns:
        Validated BackfillConfig object.

    Raises:
        ValidationError: If required configuration is missing or invalid.
        ConnectionStringError: If PostgreSQL connection string is missing or invalid.
    """
    config_dict: dict[str, Any] = {}

    # Load PostgreSQL connection string with validation and dialect transformation
    config_dict["postgres_connection_string"] = load_connection_string()

    # Load Strava client credentials from secret volumes
    strava_secrets = load_strava_secrets()
    config_dict.update(strava_secrets)

    return BackfillConfig(**config_dict)
